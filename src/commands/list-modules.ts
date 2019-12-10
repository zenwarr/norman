import { getConfig } from "../config";


export async function listModulesCommand() {
  const config = getConfig();

  for (let module of config.modules) {
    console.log(`${ module.name }: ${ module.path }`);
  }
}
