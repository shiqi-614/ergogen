const stage_configs = {
  dev: {
    KICADGEN_API_URL: 'http://127.0.0.1:5001/generate',
  },
  prod: {
    KICADGEN_API_URL: 'http://kicadgen:5001/generate',
  },
};

const ENV = process.env.NODE_ENV || 'prod';

module.exports = stage_configs[ENV];
