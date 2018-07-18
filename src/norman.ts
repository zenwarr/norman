import {loadConfig} from "./config";
import ModuleSynchronizer from "./synchronizer";
import ModuleFetcher from "./fetcher";


export default async function start(): Promise<void> {
  let config = loadConfig();

  let fetcher = new ModuleFetcher(config);
  let synchronizer = new ModuleSynchronizer(config);

  // init plugins
  config.pluginInstances = config.pluginClasses.map(pluginClass => new pluginClass(config, fetcher, synchronizer));

  await fetcher.start();
  await synchronizer.start();
}
