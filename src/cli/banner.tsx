import chalk from 'chalk';

const TAGLINE = 'Universal MCP Server Installer';
const BANNER_MARGIN_LEFT = 2;
const BANNER_MARGIN_TOP = 1;
const LOGO = [
	'███████╗██╗   ██╗███████╗██████╗ ██╗   ██╗███╗   ███╗ ██████╗██████╗ ',
	'██╔════╝██║   ██║██╔════╝██╔══██╗╚██╗ ██╔╝████╗ ████║██╔════╝██╔══██╗',
	'█████╗  ██║   ██║█████╗  ██████╔╝ ╚████╔╝ ██╔████╔██║██║     ██████╔╝',
	'██╔══╝  ╚██╗ ██╔╝██╔══╝  ██╔══██╗  ╚██╔╝  ██║╚██╔╝██║██║     ██╔═══╝ ',
	'███████╗ ╚████╔╝ ███████╗██║  ██║   ██║   ██║ ╚═╝ ██║╚██████╗██║     ',
	'╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝ ╚═════╝╚═╝     '
].join('\n');

type BannerOutput = Pick<NodeJS.WriteStream, 'write'>;

function withLeftMargin(text: string, spaces: number): string {
	const prefix = ' '.repeat(Math.max(0, spaces));
	return text
		.split('\n')
		.map(line => `${prefix}${line}`)
		.join('\n');
}

export async function printBanner(output: BannerOutput = process.stdout): Promise<void> {
	output.write('\n'.repeat(BANNER_MARGIN_TOP));
	output.write(`${withLeftMargin(chalk.cyanBright(LOGO), BANNER_MARGIN_LEFT)}\n`);
	output.write(`${withLeftMargin(chalk.bold.white(TAGLINE), BANNER_MARGIN_LEFT)}\n\n`);
}
