import { getProject } from "../project";
import * as columnify from "columnify";
import { getRegistryForModule } from "../registry-paths";


export async function listModulesCommand() {
  const config = getProject();

  const data = config.modules.map(module => ({
    name: module.name ? module.name.name : "<no name>",
    path: module.path,
    registry: getRegistryForModule(module),
    useNpm: module.useNpm
  }));

  console.log(columnify(data, {
    columnSplitter: " | "
  }));
}
