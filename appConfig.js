(function(root) {
  var config = {
    BETA_DISABLE_EXTERNAL_SERVICES: true,
    BETA_DISABLED_MESSAGE: "L'applicazione è ancora in beta, alcune funzioni sono temporaneamente disabilitate."
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = config;
    return;
  }

  root.ActionFlowConfig = Object.assign({}, root.ActionFlowConfig || {}, config);
})(typeof window !== "undefined" ? window : globalThis);
