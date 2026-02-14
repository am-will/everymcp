import React from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import type {ConfigChange, ConfigScope, DetectedAgent, TransportType} from '../types/index.js';
import {printBanner} from './banner.js';
import {DiffPreview} from './diff-preview.js';
import {ProgressSpinner, type AgentProgressItem} from './spinner.js';
import {Wizard} from './wizard.js';

export interface AppProps {
	detectedAgents: DetectedAgent[];
	scope: ConfigScope;
	transport: TransportType;
	interactive?: boolean;
	dryRun?: boolean;
	executing?: boolean;
	changes?: ConfigChange[];
	progressAgents?: AgentProgressItem[];
	summaryLines?: string[];
	onSelectionSubmit?: (selected: string[]) => void;
	onExit?: () => void;
}

function getScopePath(agent: DetectedAgent, scope: ConfigScope): string {
	return agent.configPaths.find(pathInfo => pathInfo.scope === scope)?.path ?? agent.configPaths[0]?.path ?? 'no config path';
}

function renderDetectionList(
	detectedAgents: DetectedAgent[],
	scope: ConfigScope,
	transport: TransportType
): React.JSX.Element {
	if (detectedAgents.length === 0) {
		return <Text color="yellow">No supported agents detected on this system.</Text>;
	}

	return (
		<Box flexDirection="column">
			{detectedAgents.map(agent => {
				const scopeSupported = agent.adapter.supportedScopes.includes(scope);
				const transportSupported = agent.adapter.supportedTransports.includes(transport);
				const compatible = scopeSupported && transportSupported;
				const marker = compatible ? '✓' : '!';

				return (
					<Text key={agent.adapter.id}>
						{marker} {agent.adapter.displayName} ({getScopePath(agent, scope)})
						{!compatible && ' - incompatible with selected scope/transport'}
					</Text>
				);
			})}
		</Box>
	);
}

export function App({
	detectedAgents,
	scope,
	transport,
	interactive = false,
	dryRun = false,
	executing = false,
	changes = [],
	progressAgents = [],
	summaryLines = [],
	onSelectionSubmit,
	onExit
}: AppProps): React.JSX.Element {
	const {exit} = useApp();
	const hasPending = progressAgents.some(agent => agent.status === 'pending');
	const operationFinished = progressAgents.length > 0 && !hasPending;
	const restartNotes = progressAgents
		.filter(agent => agent.warning?.toLowerCase().includes('restart'))
		.map(agent => `${agent.name}: ${agent.warning as string}`);

	useInput((input, key) => {
		if (input === 'q' || key.escape || (input === 'c' && key.ctrl)) {
			onExit?.();
			exit();
		}
	});

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>everymcp</Text>
			<Text dimColor>
				Scope: {scope} | Transport: {transport}
			</Text>

			<Box flexDirection="column">
				<Text bold>Detected agents</Text>
				{renderDetectionList(detectedAgents, scope, transport)}
			</Box>

			{interactive && onSelectionSubmit && (
				<Box flexDirection="column" marginTop={1}>
					<Wizard
						detectedAgents={detectedAgents}
						onSubmit={onSelectionSubmit}
						scope={scope}
						transport={transport}
					/>
				</Box>
			)}

			{dryRun && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Dry-run preview</Text>
					<DiffPreview changes={changes} />
				</Box>
			)}

			{executing && progressAgents.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<ProgressSpinner agents={progressAgents} message="Applying configuration changes" />
				</Box>
			)}

			{operationFinished && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Summary</Text>
					{summaryLines.map(line => (
						<Text key={line}>{line}</Text>
					))}
					{restartNotes.map(note => (
						<Text color="yellow" key={note}>
							Restart required: {note}
						</Text>
					))}
				</Box>
			)}

			<Text dimColor>Press q to quit.</Text>
		</Box>
	);
}

export async function runCliApp(
	props: AppProps,
	options?: Parameters<typeof render>[1]
): Promise<ReturnType<typeof render>> {
	await printBanner();
	return render(<App {...props} />, options);
}

interface WizardRunnerProps {
	detectedAgents: DetectedAgent[];
	scope: ConfigScope;
	transport: TransportType;
	onDone: (selected: string[]) => void;
}

function WizardRunner({detectedAgents, scope, transport, onDone}: WizardRunnerProps): React.JSX.Element {
	const {exit} = useApp();

	useInput((input, key) => {
		if (key.escape || input === 'q' || (input === 'c' && key.ctrl)) {
			onDone([]);
			exit();
		}
	});

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>Select target agents</Text>
			<Wizard
				detectedAgents={detectedAgents}
				onSubmit={selected => {
					onDone(selected);
					exit();
				}}
				scope={scope}
				transport={transport}
			/>
			<Text dimColor>Press Esc to cancel.</Text>
		</Box>
	);
}

export async function runWizard(
	detectedAgents: DetectedAgent[],
	scope: ConfigScope,
	transport: TransportType
): Promise<string[]> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const instance = render(
			<WizardRunner
				detectedAgents={detectedAgents}
				onDone={selected => {
					if (settled) {
						return;
					}
					settled = true;
					resolve(selected);
				}}
				scope={scope}
				transport={transport}
			/>
		);

		instance.waitUntilExit().catch(error => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		});
	});
}
