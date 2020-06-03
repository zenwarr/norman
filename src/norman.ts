import * as chalk from "chalk";
import { Project } from "./project";
import { listModulesCommand } from "./commands/list-modules";
import { dependencyTreeCommand } from "./commands/dependency-tree";
import { fetchCommand } from "./commands/fetch";
import { cleanCommand } from "./commands/clean";
import { ArgumentsManager, getArgs } from "./arguments";
import { NpmRC } from "./npmrc";
import { ModuleStateManager } from "./module-state-manager";
import { npmCommand } from "./commands/npm";
import { outdatedCommand } from "./upgrade/outdated-command";
import { publishCommand } from "./commands/publish";
import { Config } from "./config/config";
import { startServerCommand } from "./commands/server";
import { shutdown } from "./shutdown";
import { syncCommand } from "./sync/sync-command";
import { syncAllCommand } from "./sync/sync-all-command";
import { releaseCommand } from "./release/release-command";
import { PackageReader } from "./package-reader";
import { NpmInfoReader } from "./npm-info-reader";


async function asyncStart(): Promise<void> {
  ArgumentsManager.init();
  Config.init();
  NpmRC.init();
  PackageReader.init();
  NpmInfoReader.init();

  let args = getArgs();

  if (args.subCommand !== "server") {
    Project.init();
    ModuleStateManager.init();
  }

  const COMMANDS: { [name: string]: () => Promise<void> | void } = {
    "list-modules": listModulesCommand,
    "dependency-tree": dependencyTreeCommand,
    fetch: fetchCommand,
    sync: syncCommand,
    clean: cleanCommand,
    "sync-all": syncAllCommand,
    outdated: outdatedCommand,
    npm: npmCommand,
    publish: publishCommand,
    server: startServerCommand,
    release: releaseCommand
  };

  const command = COMMANDS[args.subCommand];
  if (!command) {
    throw new Error("Unknown command");
  }

  await command();
}


export function start(): void {
  // tslint:disable-next-line no-floating-promises
  asyncStart().then(() => {
    shutdown(0);
  });
}


process.on("SIGINT", () => {
  console.log("sigint");
  shutdown();
});


process.on("unhandledRejection", (error: unknown) => {
  console.error(chalk.red("Unhandled rejection"), error);
  shutdown(-1);
});


process.on("uncaughtException", (error: Error) => {
  console.error(chalk.red("Uncaught exception"), error);
  shutdown(-1);
});
