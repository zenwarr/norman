import { getArgs } from "../arguments";
import { getProject } from "../project";
import { NpmRunner } from "../module-npm-runner";
import { NpmRegistry } from "../registry";


export async function npmCommand() {
  let args = getArgs();
  if (args.subCommand !== "npm") {
    return;
  }

  let config = getProject();

  let dir = process.cwd();

  let mod = config.modules.find(module => module.path === dir);
  if (!mod) {
    throw new Error(`Failed to find local module at current working directory ("${ dir }")`);
  }

  await NpmRegistry.init();

  await NpmRunner.run(mod, args.args);
}
