import * as fs from "fs-extra";
import * as path from "path";
import * as utils from "./utils";
import {ModuleBase} from "./base";
import * as os from "os";


const TEMP_DIR = path.join(os.tmpdir(), "norman");


export class ModulePackager extends ModuleBase {
  public async pack(stateHash: string): Promise<string> {
    if (this.norman.args.subCommand === "sync" && this.norman.args.buildDeps) {
      await this.module.buildModuleIfChanged();
    }

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirpSync(TEMP_DIR);
    }

    let tempDir = path.join(TEMP_DIR, `${this.module.name}-${stateHash}`);

    await this.module.walkModuleFiles(async(source, stat) => {
      let relativeSourceFileName = path.relative(this.module.path, source);
      if (relativeSourceFileName === ".gitignore" || relativeSourceFileName === ".npmignore") {
        return;
      }

      let target = path.join(tempDir, path.relative(this.module.path, source));

      if (this.module.isIgnoredByRules(source)) {
        return;
      }

      let parentDestDir = path.dirname(target);
      if (!fs.existsSync(parentDestDir)) {
        fs.mkdirpSync(parentDestDir);
      }

      if (!stat.isDirectory()) {
        await this.module.copyFile(source, target);
      } else {
        fs.mkdirpSync(target);
      }
    });

    await utils.runCommand(utils.getNpmExecutable(), [ "pack" ], {
      cwd: tempDir,
      silent: true
    });

    return this.getArchivePathFromDir(tempDir);
  }


  public getArchivePathFromDir(outPath: string): string {
    let moduleVersion = fs.readJSONSync(path.join(outPath, "package.json")).version;

    let archiveName: string;
    if (this.module.npmName.org) {
      archiveName = `${this.module.npmName.org}-${this.module.npmName.pkg}-${moduleVersion}.tgz`;
    } else {
      archiveName = `${this.module.npmName.pkg}-${moduleVersion}.tgz`;
    }

    return path.join(outPath, archiveName);
  }


  public static cleanTemp(): void {
    fs.removeSync(TEMP_DIR);
  }
}
