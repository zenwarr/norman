import { getArgs } from "../arguments";
import { getConfig } from "../config";
import { NpmRunner } from "../module-npm-runner";


export async function publishCommand() {
  let args = getArgs();
  let config = getConfig();

  if (args.subCommand !== "publish") {
    return;
  }
}
