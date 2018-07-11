import {loadConfig} from "./config";
import ModuleSynchronizer from "./synchronizer";
import ModuleFetcher from "./fetcher";


export default async function start(): Promise<void> {
  let config = loadConfig();

  let fetcher = new ModuleFetcher(config);
  await fetcher.start();

  let synchronizer = new ModuleSynchronizer(config);
  await synchronizer.start();
}
