import * as fs from "fs-extra";
import * as path from "path";
import * as chalk from "chalk";
import { ModuleInfo } from "./module-info";
import * as utils from "./utils";
import { PublishDependenciesSubset } from "./publish-dependencies-subset";


/**
 * Performs quick synchronization (without using npm) of files in `from` module inside `to` module.
 */
export async function quickSync(from: ModuleInfo, to: ModuleInfo): Promise<void> {
  let syncTarget = path.join(to.path, "node_modules", from.npmName.name);
  if (utils.isSymlink(syncTarget)) {
    console.log(chalk.yellow(`Skipping sync into "${ syncTarget }" because it is a linked dependency`));
    return;
  }

  let filesCopied = await quickSyncCopy(from, syncTarget);
  let filesRemoved = await quickSyncRemove(from, syncTarget);

  if (filesCopied || filesRemoved) {
    let source = chalk.green(from.name);
    let target = chalk.green(to.name);
    console.log(`${ source } -> ${ target }: copied ${ filesCopied }, removed ${ filesRemoved }`);
  }
}


/**
 * Finds files that should be copied from source directory to target
 */
export async function quickSyncCopy(from: ModuleInfo, to: string): Promise<number> {
  let filesCopied = 0;

  const publishSubset = new PublishDependenciesSubset();

  await from.walkModuleFiles(async (filename: string, stat: fs.Stats) => {
    if (!publishSubset.isFileIncluded(from, filename)) {
      return;
    }

    let target = path.join(to, path.relative(from.path, filename));

    let isCopied: boolean;
    if (!stat.isDirectory()) {
      isCopied = await quickSyncFile(from, filename, stat, target);
    } else {
      isCopied = await quickSyncDirectory(filename, target);
    }

    if (isCopied) {
      ++filesCopied;
    }
  });

  return filesCopied;
}


async function quickSyncFile(from: ModuleInfo, source: string, sourceStat: fs.Stats, target: string): Promise<boolean> {
  try {
    const targetStat = fs.statSync(target);

    // do not copy the file if existing target file has newer or the same modification time
    if (sourceStat.mtime.valueOf() <= targetStat.mtime.valueOf()) {
      return false;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.log(chalk.red(`Error while copying to ${ target }: ${ error.message }`));
      return false;
    }
  }

  console.log(`copying `);

  let parentDestDir = path.dirname(target);
  if (!fs.existsSync(parentDestDir)) {
    fs.mkdirpSync(parentDestDir);
  }

  let isTargetExecutable = utils.hasExecPermission(target);

  utils.getRidOfIt(target);
  await from.copyFile(source, target, isTargetExecutable);

  return true;
}


async function quickSyncDirectory(source: string, target: string): Promise<boolean> {
  let targetStat: fs.Stats | null = null;

  try {
    targetStat = fs.lstatSync(target);
  } catch (error) {
    // assume it does not exists, keep silent about errors and try to create the directory
  }

  if (targetStat) {
    if (targetStat.isDirectory()) {
      // nothing to do, this is already a directory
      return false;
    } else {
      // this is a file, but we need a directory
      fs.unlinkSync(target);
    }
  }

  fs.mkdirpSync(target);
  return true;
}


async function quickSyncRemove(from: ModuleInfo, to: string): Promise<number> {
  let filesToRemove: [ string, fs.Stats ][] = [];

  const publishSubset = new PublishDependenciesSubset();

  await utils.walkDirectoryFiles(to, async (filename, stat) => {
    let relpath = path.relative(to, filename);

    let sourceFilename = path.join(from.path, relpath);
    if (!fs.existsSync(sourceFilename) || !publishSubset.isFileIncluded(from, sourceFilename)) {
      filesToRemove.push([ filename, stat ]);
    }
  });

  console.log("filesToRemove: ", filesToRemove);

  filesToRemove.forEach(item => {
    try {
      if (item[1].isDirectory()) {
        fs.removeSync(item[0]);
      } else {
        fs.unlinkSync(item[0]);
      }
    } catch (error) {
      console.log(`Failed to remove "${ item[0] }]: ${ error.message }`);
    }
  });

  return filesToRemove.length;
}
