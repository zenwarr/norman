import {Config} from "./config";
import * as path from "path";
import * as fs from "fs-extra";
import chalk from "chalk";
const sync = require("sync-directory");
import * as chokidar from "chokidar";


export default class ModuleSynchronizer {
  constructor(protected config: Config) {

  }

  async start(): Promise<void> {
    let watchingCount = 0;

    for (let module of this.config.modules) {
      let targetPath = path.join(this.config.app.home, "node_modules", module.npmName.name);

      // we should only synchronize dirs if target directory already exists or if the package specified explicitly in config
      let forceModules = this.config.app.forceModules;
      if (forceModules.indexOf(module.name) >= 0 || forceModules.indexOf(module.npmName.name) >= 0 || fs.existsSync(targetPath)) {
        ++watchingCount;
        console.log(chalk.green(`SYNC: ${module.path} → ${targetPath}`));

        fs.mkdirpSync(targetPath);
        fs.emptyDirSync(targetPath);

        let watcher: chokidar.FSWatcher = sync(module.path, targetPath, {
          watch: true,
          exclude: [ "node_modules", /.tsx?$/, /.js.map$/, ".git" ]
        });

        watcher.on("error", (error: Error) => {
          console.log(`Watcher error for ${module.name}: ${error.message}`);
        });
      }
    }

    if (!watchingCount) {
      console.log(chalk.yellow(`No modules were synchronized for app at "${this.config.app.home}". Use "app.forceModules" to list required modules or run "npm install" in app directory`));
    }
  }
}

