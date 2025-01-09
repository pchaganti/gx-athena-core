import fs from "fs/promises";

import { format, transports } from "winston";
import yaml from "yaml";

import { Athena } from "./core/athena.js";
import logger from "./utils/logger.js";

const main = async () => {
  if (process.argv.length !== 3) {
    console.error(`usage: ${process.argv[0]} ${process.argv[1]} <config-file>`);
    process.exit(1);
  }

  const configFile = process.argv[2];
  const config = yaml.parse(await fs.readFile(configFile, "utf8"));

  if (config.log_file) {
    logger.add(
      new transports.File({
        filename: config.log_file,
        format: format.combine(format.timestamp(), format.json()),
      })
    );
    logger.info(`Log file: ${config.log_file}`);
  } else {
    logger.info("Log file is not set");
  }

  logger.info(`PID: ${process.pid}`);

  let statesFile = null;
  let states = {};
  if (config.states_file) {
    try {
      statesFile = await fs.open(config.states_file, "r+");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        statesFile = await fs.open(config.states_file, "w+");
      } else {
        throw err;
      }
    }
    try {
      states = yaml.parse(await statesFile.readFile("utf8"));
    } catch (err) {}
    if (!states) {
      states = {};
    }
    logger.info(`States file: ${config.states_file}`);
    logger.info(`States: ${JSON.stringify(states)}`);
  } else {
    logger.info("States file is not set");
  }

  const athena = new Athena(config, states);
  await athena.loadPlugins();

  let sigintTriggered = false;
  process.on("SIGINT", async () => {
    if (sigintTriggered) {
      return;
    }
    sigintTriggered = true;
    logger.warn("SIGINT triggered, exiting...");
    await athena.unloadPlugins();
    if (statesFile) {
      await statesFile.truncate(0);
      await statesFile.write(yaml.stringify(athena.states), 0, "utf8");
      await statesFile.close();
      logger.info("States file is saved");
      logger.info(`States: ${JSON.stringify(athena.states)}`);
    }
    logger.info("Athena is unloaded");
  });

  let reloading = false;
  process.on("SIGUSR1", async () => {
    if (reloading) {
      return;
    }
    reloading = true;
    logger.info("SIGUSR1 triggered, reloading...");
    await athena.unloadPlugins();
    if (statesFile) {
      await statesFile.truncate(0);
      await statesFile.write(yaml.stringify(athena.states), 0, "utf8");
      logger.info("States file is saved");
      logger.info(`States: ${JSON.stringify(athena.states)}`);
    }
    await athena.loadPlugins();
    logger.info("Athena is reloaded");
    reloading = false;
  });

  logger.info("Athena is loaded");
};

main();
