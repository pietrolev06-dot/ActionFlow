(function(root) {
  var betaDisabledMessage = "L'applicazione è ancora in beta, alcune funzioni sono temporaneamente disabilitate.";

  function hasProcessEnv() {
    return (
      typeof process !== "undefined" &&
      process &&
      process.env
    );
  }

  function readEnvValue(name) {
    if (!hasProcessEnv() || typeof process.env[name] === "undefined") {
      return null;
    }

    return String(process.env[name]).trim();
  }

  function isExternalServicesDisabled() {
    if (!hasProcessEnv()) {
      return false;
    }

    var value = readEnvValue("BETA_DISABLE_EXTERNAL_SERVICES");
    return !value || value.toLowerCase() !== "false";
  }

  function getPublicConfig() {
    return {
      BETA_DISABLE_EXTERNAL_SERVICES: isExternalServicesDisabled(),
      BETA_DISABLED_MESSAGE: betaDisabledMessage
    };
  }

  function toClientScript() {
    return [
      "(function(root) {",
      "  root.ActionFlowConfig = Object.assign({}, root.ActionFlowConfig || {}, " + JSON.stringify(getPublicConfig()) + ");",
      "})(typeof window !== \"undefined\" ? window : globalThis);",
      ""
    ].join("\n");
  }

  var config = getPublicConfig();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign({}, config, {
      getPublicConfig: getPublicConfig,
      toClientScript: toClientScript
    });
    return;
  }

  root.ActionFlowConfig = Object.assign({}, root.ActionFlowConfig || {}, config);
})(typeof window !== "undefined" ? window : globalThis);
