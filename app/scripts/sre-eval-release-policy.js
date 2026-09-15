const RELEASE_CHANNEL_ALIASES = {
  local: "local",
  dev: "local",
  pr: "pull_request",
  pull_request: "pull_request",
  pullrequest: "pull_request",
  canary: "canary",
  rc: "release_candidate",
  release_candidate: "release_candidate",
  releasecandidate: "release_candidate",
  stable: "stable",
  prod: "stable",
  production: "stable",
};

const BLOCKING_ADVANCED_CHANNELS = new Set(["release_candidate", "stable"]);

function envFlag(value) {
  return value === "true" || value === "1" || value === "yes";
}

function normalizeReleaseChannel(value) {
  const normalized = String(value || "local").trim().toLowerCase().replace(/[-\s]/g, "_");
  return RELEASE_CHANNEL_ALIASES[normalized] ?? "local";
}

function inferReleaseChannel(env = process.env) {
  const explicit = env.SRE_EVAL_RELEASE_CHANNEL || env.SRE_EVAL_RELEASE_PROFILE;
  if (explicit) return normalizeReleaseChannel(explicit);
  if (env.GITHUB_EVENT_NAME === "pull_request") return "pull_request";
  return "local";
}

function buildSreEvalReleasePolicy(env = process.env) {
  const channel = inferReleaseChannel(env);
  const liveEnabled = envFlag(env.SRE_EVAL_LIVE_ENABLED);
  const modelGradeEnabled = envFlag(env.SRE_EVAL_MODEL_GRADE_ENABLED);
  const liveRequired = envFlag(env.SRE_EVAL_RELEASE_REQUIRE_LIVE) || BLOCKING_ADVANCED_CHANNELS.has(channel);
  const modelGradeRequired =
    envFlag(env.SRE_EVAL_RELEASE_REQUIRE_MODEL_GRADE) || BLOCKING_ADVANCED_CHANNELS.has(channel);

  return {
    channel,
    deterministic: { enabled: true, required: true },
    live: {
      enabled: liveEnabled,
      required: liveRequired,
      mode: liveRequired ? "blocking" : liveEnabled ? "advisory" : "skipped",
    },
    modelGrade: {
      enabled: modelGradeEnabled,
      required: modelGradeRequired,
      mode: modelGradeRequired ? "blocking" : modelGradeEnabled ? "advisory" : "skipped",
    },
  };
}

function missingEnv(env, names) {
  return names.filter((name) => !env[name]?.trim());
}

function validateSreEvalReleasePolicy(policy, env = process.env) {
  if (policy.live.required && !policy.live.enabled) {
    throw new Error(
      `${policy.channel} SRE eval release policy requires SRE_EVAL_LIVE_ENABLED=true`
    );
  }

  if (policy.live.enabled) {
    const missing = missingEnv(env, ["SRE_EVAL_BASE_URL", "SRE_EVAL_AUTH_TOKEN", "SRE_EVAL_INCIDENT_IDS"]);
    if (missing.length > 0) {
      throw new Error(`Live SRE eval release gate requires: ${missing.join(", ")}`);
    }
  }

  if (policy.modelGrade.required && !policy.modelGrade.enabled) {
    throw new Error(
      `${policy.channel} SRE eval release policy requires SRE_EVAL_MODEL_GRADE_ENABLED=true`
    );
  }

  if (policy.modelGrade.enabled && !policy.live.enabled) {
    throw new Error("SRE_EVAL_MODEL_GRADE_ENABLED=true requires SRE_EVAL_LIVE_ENABLED=true");
  }

  if (policy.modelGrade.enabled) {
    const missing = missingEnv(env, ["SRE_EVAL_EVALUATED_MODEL_ID"]);
    if (missing.length > 0) {
      throw new Error(`Model-graded SRE eval release gate requires: ${missing.join(", ")}`);
    }

    const evaluatedModel = env.SRE_EVAL_EVALUATED_MODEL_ID?.trim();
    const graderModel = env.SRE_EVAL_GRADER_MODEL_ID?.trim();
    if (
      evaluatedModel &&
      graderModel &&
      evaluatedModel === graderModel &&
      !envFlag(env.SRE_EVAL_MODEL_GRADE_ALLOW_SAME_MODEL)
    ) {
      throw new Error(
        "Model-graded SRE eval release gate requires SRE_EVAL_GRADER_MODEL_ID to differ from SRE_EVAL_EVALUATED_MODEL_ID"
      );
    }
  }
}

function summarizeSreEvalReleasePolicy(policy) {
  return [
    `channel=${policy.channel}`,
    `deterministic=${policy.deterministic.required ? "blocking" : "advisory"}`,
    `live=${policy.live.mode}`,
    `modelGrade=${policy.modelGrade.mode}`,
  ].join(" ");
}

module.exports = {
  buildSreEvalReleasePolicy,
  envFlag,
  inferReleaseChannel,
  normalizeReleaseChannel,
  summarizeSreEvalReleasePolicy,
  validateSreEvalReleasePolicy,
};
