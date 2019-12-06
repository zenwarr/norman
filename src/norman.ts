import * as chalk from "chalk";
import { Config } from "./config";
import { listModulesCommand } from "./commands/list-modules";
import { dependencyTreeCommand } from "./commands/dependency-tree";
import { fetchCommand } from "./commands/fetch";
import { syncCommand } from "./commands/sync";
import { cleanCommand } from "./commands/clean";
import { syncAllCommand } from "./commands/sync-all";
import { outdatedCommand } from "./commands/outdated";
import { ArgumentsManager, getArgs } from "./arguments";


async function asyncStart(): Promise<void> {
  ArgumentsManager.init();
  Config.init();


  let args = getArgs();

  const COMMANDS: { [name: string]: () => Promise<void> | void } = {
    "list-modules": listModulesCommand,
    "dependency-tree": dependencyTreeCommand,
    fetch: fetchCommand,
    sync: syncCommand,
    clean: cleanCommand,
    "sync-all": syncAllCommand,
    outdated: outdatedCommand
  };

  const command = COMMANDS[args.subCommand];
  if (!command) {
    throw new Error("Unknown command");
  }

  await command();
}


export function start(): void {
  asyncStart().catch((error: Error) => {
    console.log(chalk.red(`Error: ${ error.message }`));
    console.error(error);
    process.exit(-1);
  });
}


process.on("uncaughtException", (error) => {
  console.log(chalk.red(`UNHANDLED EXCEPTION: ${ error.message }: ${ error.stack }`));
  process.exit(-1);
});

process.on("unhandledRejection", (error: any) => {
  console.log(chalk.red(`UNHANDLED REJECTION: ${ error.message }: ${ error.stack }`));
  process.exit(-1);
});
