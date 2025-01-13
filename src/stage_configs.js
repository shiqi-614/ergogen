const stage_configs = {
  development: {
    KICADGEN_API_URL: 'http://127.0.0.1:5001/generate',
  },
  production: {
    KICADGEN_API_URL: 'http://kicadgen:5001/generate',
  },
};

const getStage  = () => {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) {
    return process.env.NODE_ENV;
  } else if (typeof window !== 'undefined' && window.stage) {
    return window.stage;
  } else {
    return 'production';
  }
};


module.exports = stage_configs[getStage()];
