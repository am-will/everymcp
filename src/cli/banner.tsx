import chalk from 'chalk';

const TAGLINE = 'Universal MCP Server Installer';
const LOGO = [
	'███████╗██╗   ██╗███████╗██████╗ ██╗   ██╗███╗   ███╗ ██████╗██████╗ ',
	'██╔════╝██║   ██║██╔════╝██╔══██╗╚██╗ ██╔╝████╗ ████║██╔════╝██╔══██╗',
	'█████╗  ██║   ██║█████╗  ██████╔╝ ╚████╔╝ ██╔████╔██║██║     ██████╔╝',
	'██╔══╝  ╚██╗ ██╔╝██╔══╝  ██╔══██╗  ╚██╔╝  ██║╚██╔╝██║██║     ██╔═══╝ ',
	'███████╗ ╚████╔╝ ███████╗██║  ██║   ██║   ██║ ╚═╝ ██║╚██████╗██║     ',
	'╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝ ╚═════╝╚═╝     '
].join('\n');

type BannerOutput = Pick<NodeJS.WriteStream, 'write'>;

export async function printBanner(output: BannerOutput = process.stdout): Promise<void> {
	output.write(`${chalk.cyanBright(LOGO)}\n`);
	output.write(`${chalk.bold.white(TAGLINE)}\n\n`);
}
