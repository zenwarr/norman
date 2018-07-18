import {loadConfig} from "./config";
import ModuleSynchronizer from "./synchronizer";
import ModuleFetcher from "./fetcher";
import chalk from "chalk";


async function _start(): Promise<void> {
  let config = loadConfig();

  let fetcher = new ModuleFetcher(config);
  let synchronizer = new ModuleSynchronizer(config);

  // init plugins
  config.pluginInstances = config.pluginClasses.map(pluginClass => new pluginClass(config, fetcher, synchronizer));

  await fetcher.start();
  await synchronizer.start();
}


export function start(): void {
  _start().then(() => {

  }, (error: Error) => {
    console.log(chalk.red(`Error: ${error.message}`));
    console.error(error);
  });
}
