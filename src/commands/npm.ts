import { getArgs } from "../arguments";
import { getConfig } from "../config";
import { NpmRunner } from "../module-npm-runner";
import { getServer, LocalNpmServer } from "../server";


export async function npmCommand() {
  let args = getArgs();
  if (args.subCommand !== "npm") {
    return;
  }

  let config = getConfig();

  let dir = process.cwd();

  let mod = config.modules.find(module => module.path === dir);
  if (!mod) {
    throw new Error(`Failed to find local module at current working directory ("${ dir }")`);
  }

  await LocalNpmServer.init();

  try {
    await NpmRunner.run(mod, args.args);
  } finally {
    await getServer().stop();
  }
}
