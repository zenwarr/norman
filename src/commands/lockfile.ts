import * as path from "path";
import * as fs from "fs";
import { getConfig } from "../config";
import { Lockfile } from "../lockfile";
import { runCommand } from "../utils";


export async function updateLockfileCommand() {
  const config = getConfig();

  for (let module of config.modules) {
    if (module.lockfileEnabled) {
      const lockfilePath = path.join(module.path, "package-lock.json");

      if (!fs.existsSync(lockfilePath)) {
        await runCommand("npm", [ "install", "--package-lock-only" ], {
          cwd: module.path
        });
      }

      console.log(`updating lockfile at ${lockfilePath}`);

      const lockfile = new Lockfile(lockfilePath);
      lockfile.update();
    }
  }
}
