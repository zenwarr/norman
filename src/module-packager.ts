import * as fs from "fs-extra";
import * as path from "path";
import * as utils from "./utils";
import { ModuleOperator } from "./base";
import * as os from "os";
import * as ssri from "ssri";
import { getArgs } from "./arguments";
import { getConfig } from "./config";
import { walkDependencyTree, WalkerAction } from "./dependency-tree";


const TEMP_DIR = path.join(os.tmpdir(), "norman");


export class ModulePackager extends ModuleOperator {
  public getActualIntegrity(): string {
    const manifestContent = fs.readFileSync(path.join(this.module.path, "package.json"));
    return ssri.create().update(manifestContent).digest().toString();
  }


  private getActualPackageDir(): string {
    const integrity = encodeURIComponent(this.getActualIntegrity());
    return path.join(TEMP_DIR, `${ this.module.name }-${ integrity }`);
  }


  /**
   * Returns path to a tarball matching actual package.json integrity of this module.
   */
  public getActualTarballPath() {
    const tempPackagePath = this.getActualPackageDir();

    if (!fs.existsSync(tempPackagePath)) {
      throw new Error(`Failed to find prepackaged archive for module "${ this.module.name }", maybe package.json changed after running npm install?`);
    }

    const archivePath = this.getTarballPathFromDir(tempPackagePath);
    if (!fs.existsSync(archivePath)) {
      throw new Error(`Failed find prepackaged archive for module "${ this.module.name }", maybe package name in package.json is wrong?`);
    }

    return archivePath;
  }


  public getActualTarballIntegrity(): string {
    const tarballPath = this.getActualTarballPath();
    const tarballData = fs.readFileSync(tarballPath);
    return ssri.create().update(tarballData).digest().toString();
  }


  public hasActualTarball() {
    const tempPackagePath = this.getActualPackageDir();

    if (!fs.existsSync(tempPackagePath)) {
      return false;
    }

    const archivePath = this.getTarballPathFromDir(tempPackagePath);
    return fs.existsSync(archivePath);
  }


  private async updateTarball(): Promise<void> {
    const args = getArgs();

    if (args.subCommand === "sync" && args.buildDeps) {
      await this.module.buildModuleIfChanged();
    }

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirpSync(TEMP_DIR);
    }

    let tempDir = this.getActualPackageDir();

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
  }


  private getTarballPathFromDir(outPath: string): string {
    const manifest = fs.readJSONSync(path.join(outPath, "package.json"));
    const version = manifest.version;

    let archiveName: string;
    if (this.module.npmName.org) {
      archiveName = `${ this.module.npmName.org }-${ this.module.npmName.pkg }-${ version }.tgz`;
    } else {
      archiveName = `${ this.module.npmName.pkg }-${ version }.tgz`;
    }

    return path.join(outPath, archiveName);
  }


  public static cleanTemp(): void {
    fs.removeSync(TEMP_DIR);
  }


  public static async prepackLocalModules() {
    await walkDependencyTree(getConfig().modules, async module => {
      const packager = new ModulePackager(module);
      if (packager.hasActualTarball()) {
        return WalkerAction.Continue;
      }

      await packager.updateTarball();

      return WalkerAction.Continue;
    });
  }
}
