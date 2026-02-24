import { config } from "./config.js";

export const fastifyLoggerOptions = {
  level: config.nodeEnv === "development" ? "debug" : "info",
};
