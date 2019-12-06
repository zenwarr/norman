import { getServer, LocalNpmServer } from "../server";
import { fetchModules, installModules } from "../fetcher";
import { getArgs } from "../arguments";


export async function fetchCommand() {
  const args = getArgs();

  if (args.subCommand !== "fetch") {
    return;
  }

  await LocalNpmServer.init();

  try {
    await fetchModules();

    if (!args.noInstall) {
      await installModules();
    }
  } finally {
    await getServer().stop();
  }
}
