import { getConfig } from "../config";
import * as columnify from "columnify";
import { getRegistryForModule } from "../registry-paths";


export async function listModulesCommand() {
  const config = getConfig();

  const data = config.modules.map(module => ({
    name: module.name,
    path: module.path,
    registry: getRegistryForModule(module)
  }));

  console.log(columnify(data, {
    columnSplitter: " | "
  }));
}
