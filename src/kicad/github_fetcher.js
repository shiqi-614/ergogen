const axios = require('axios');
const Cache = require('./cache');

// Files are kept until their repo changes them (checkRepo), not for a fixed time; the TTL only clears out files
// nothing has asked for in a month.
const MONTH = 30 * 24 * 60 * 60 * 1000;
const gitCache = new Cache('github', MONTH);
// per repo: the commit the cached files were last checked against, and the blob id of each of its files
const repoCache = new Cache('github_repos', MONTH);

const GITHUB_RAW_BASE_URL = 'https://raw.githubusercontent.com';
const GITHUB_API_URL = 'https://api.github.com';

// some callers give the repo with a trailing slash
const repoOf = (github) => github.repo.replace(/\/+$/, '');

function getKey(github) {
    return [repoOf(github), github.file].join("/");
}

// A repo's main branch is looked up at most this often: GitHub allows 60 API requests an hour without a token.
const RECHECK_MS = 5 * 60 * 1000;
const checks = new Map();

// The commit at the head of the repo's main branch. Files it changed since the last check are dropped from every
// cache first, so the next fetch downloads them again. Without an answer from GitHub (offline, rate limited) the
// cached files stay in use, as of the last commit seen, or null for none.
function checkRepo(name) {
    const repo = name.replace(/\/+$/, '');
    const last = checks.get(repo);
    if (last && Date.now() - last.at < RECHECK_MS) return last.commit;
    const commit = (async () => {
        const known = repoCache.get(repo);
        let head;
        try {
            const { data } = await axios.get(`${GITHUB_API_URL}/repos/${repo}/commits/main`, {
                headers: { Accept: 'application/vnd.github.sha' }
            });
            head = String(data).trim();
        } catch (error) {
            console.warn(`Can't check ${repo} for changes, using the cached files:`, error.message);
            return known ? known.commit : null;
        }
        if (known && known.commit === head) {
            repoCache.set(repo, known);
            return head;
        }
        let blobs = null;
        try {
            const { data } = await axios.get(`${GITHUB_API_URL}/repos/${repo}/git/trees/${head}?recursive=1`);
            if (!data.truncated) {
                blobs = {};
                for (const entry of data.tree) {
                    if (entry.type === 'blob') blobs[entry.path] = entry.sha;
                }
            }
        } catch (error) {
            console.warn(`Can't list the files of ${repo}:`, error.message);
        }
        // without both lists of files, all of the repo's go
        const changed = known && blobs
            ? [...new Set([...Object.keys(known.blobs), ...Object.keys(blobs)])].filter(path => known.blobs[path] !== blobs[path])
            : null;
        Cache.forget(repo, changed);
        if (blobs) {
            repoCache.set(repo, { commit: head, blobs });
        } else {
            repoCache.delete(repo);
        }
        return head;
    })();
    checks.set(repo, { at: Date.now(), commit });
    return commit;
}

// The blob id of a file at the commit checkRepo last saw: undefined while that commit's files aren't known (GitHub
// didn't answer), null when the commit has no such file.
function blobOf(name, path) {
    const known = repoCache.get(name.replace(/\/+$/, ''));
    if (!known) return undefined;
    return known.blobs[path] || null;
}

// where a file of a commit (or of a branch) is downloaded from
function rawUrl(name, ref, path) {
    const file = path.split('/').map(encodeURIComponent).join('/');
    return `${GITHUB_RAW_BASE_URL}/${name.replace(/\/+$/, '')}/${ref}/${file}`;
}

// a file that several parts ask for at once is downloaded once
const downloads = new Map();

async function fetchFromGithub(github) {
    const key = getKey(github);
    const commit = await checkRepo(github.repo);

    if (gitCache.has(key)) {
        return gitCache.get(key);
    }

    if (!downloads.has(key)) {
        downloads.set(key, (async () => {
            // a file of a known commit never changes, and all files of a run come from the same commit
            const url = `${GITHUB_RAW_BASE_URL}/${repoOf(github)}/${commit || 'main'}/${github.file}`;
            const { data } = await axios.get(url);
            const response = { data };

            // 存储缓存数据和时间戳（只存文件内容）
            gitCache.set(key, response);

            console.log('Fetched and cached data:', key);

            return response;
        })().finally(() => downloads.delete(key)));
    }

    try {
        return await downloads.get(key);
    } catch (error) {
        console.error('Error fetching data:', error.message);
        throw error;
    }
}

module.exports = { fetchFromGithub, checkRepo, blobOf, rawUrl };
