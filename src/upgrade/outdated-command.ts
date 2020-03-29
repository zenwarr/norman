import { getRegistry, NpmRegistry } from "../registry";
import * as chalk from "chalk";
import { getArgs } from "../arguments";
import { getProject } from "../project";
import { getOutdated, upgradeDependency } from "./upgrade";


export async function outdatedCommand() {
  let args = getArgs();
  let config = getProject();

  if (args.subCommand !== "outdated") {
    return;
  }

  await NpmRegistry.init();

  try {
    let results: any = {};
    let index = 1;

    let modsToAnalyze = args.withIncluded ? config.modules : config.modules.filter(mod => mod.config.isFromMainProject);
    for (let mod of modsToAnalyze) {
      console.log(`[${ index }/${ modsToAnalyze.length }] Analyzing dependencies of "${ mod.name }"...`);
      ++index;

      let result = await getOutdated(mod);
      if (Object.keys(result).length) {
        results[mod.checkedName.name] = result;
      }
    }

    if (!args.upgrade) {
      console.log(chalk.green("\n-- REPORT"));
      console.log(buildOutdatedReport(results));
    } else {
      await upgradeModules(results, args.hard);
    }
  } finally {
    getRegistry().stop();
  }
}


function buildOutdatedReport(outdatedData: any): string {
  let depGroups: any = {};

  for (let mod of Object.keys(outdatedData)) {
    for (let dep of Object.keys(outdatedData[mod])) {
      let depData = outdatedData[mod][dep];

      if (dep in depGroups) {
        depGroups[dep][mod] = depData;
      } else {
        depGroups[dep] = { [mod]: depData };
      }
    }
  }

  let lines: string[] = [];

  for (let dep of Object.keys(depGroups)) {
    lines.push(chalk.blue(dep) + ":");

    for (let mod of Object.keys(depGroups[dep])) {
      let depData = depGroups[dep][mod];

      let wanted = depData.wanted !== depData.current ? chalk.yellow(depData.wanted) : depData.wanted;
      let latest = depData.latest !== depData.wanted ? chalk.red(depData.latest) : depData.latest;
      lines.push(`  ${ mod }: installed ${ depData.current }, wanted ${ wanted }, latest ${ latest }`);
    }
  }

  if (!lines.length) {
    lines.push(chalk.green("All modules are up to date"));
  }

  return lines.join("\n");
}


async function upgradeModules(outdatedData: any, hard: boolean): Promise<void> {
  const config = getProject();

  for (let mod of config.modules) {
    if (!mod.name) {
      continue;
    }

    let modData = outdatedData[mod.name.name];
    if (!modData) {
      continue;
    }

    for (let dep of Object.keys(modData)) {
      let depData = modData[dep];
      let installVersion = hard ? depData.latest : depData.wanted;
      if (installVersion === depData.current) {
        continue;
      }

      console.log(`Upgrading dependencies of "${ mod.name }": "${ dep }@${ depData.current }" -> "${ dep }@${ installVersion }"`);
      try {
        await upgradeDependency(mod, dep, installVersion);
      } catch (error) {
        console.error(chalk.red(`Failed to upgrade dependency of "${ mod.name }": "${ dep }" to version ${ installVersion }`));
      }
    }
  }
}
