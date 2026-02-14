import React, {useMemo, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {MultiSelect, TextInput} from '@inkjs/ui';
import {printBanner} from './banner.js';

type ScopeValue = 'global' | 'project';
type TransportValue = 'stdio' | 'http' | 'sse';

type LauncherStep =
	| 'action'
	| 'addServerSpec'
	| 'addName'
	| 'addAuthToken'
	| 'addOauthClientId'
	| 'addScope'
	| 'addTargetAgents'
	| 'removeName'
	| 'removeScope'
	| 'listScope'
	| 'restoreMode';

type ActionValue = 'add' | 'remove' | 'list' | 'detect' | 'backup' | 'restore' | 'quit';
const SELECT_ALL_VALUE = '__everymcp_select_all__';

export interface LauncherResult {
	command: 'add' | 'remove' | 'list' | 'detect' | 'backup' | 'restore';
	args?: string[];
	options?: Record<string, unknown>;
}

interface MenuOption {
	label: string;
	value: string;
	hint?: string;
}

interface MenuPromptProps {
	title: string;
	description?: string;
	options: MenuOption[];
	defaultIndex?: number;
	onSubmit: (value: string) => void;
}

interface TextPromptProps {
	title: string;
	description?: string;
	placeholder?: string;
	defaultValue?: string;
	inputKey?: string;
	onSubmit: (value: string) => void;
}

interface LauncherAppProps {
	initialOptions: Record<string, unknown>;
	onDone: (result: LauncherResult | null) => void;
}

interface DetectedAgentOption {
	id: string;
	displayName: string;
	supportedScopes: ScopeValue[];
	supportedTransports: TransportValue[];
}

function toBoolean(value: unknown, fallback = false): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function toString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function toScope(initialOptions: Record<string, unknown>): ScopeValue {
	return initialOptions.project === true ? 'project' : 'global';
}

function toAgents(initialOptions: Record<string, unknown>): string[] {
	if (!Array.isArray(initialOptions.agents)) {
		return [];
	}

	return initialOptions.agents.map(value => String(value).trim()).filter(Boolean);
}

function toDetectedAgents(initialOptions: Record<string, unknown>): DetectedAgentOption[] {
	if (!Array.isArray(initialOptions.detectedAgents)) {
		return [];
	}

	const result: DetectedAgentOption[] = [];
	for (const item of initialOptions.detectedAgents) {
		if (!item || typeof item !== 'object') {
			continue;
		}

		const value = item as Record<string, unknown>;
		const id = typeof value.id === 'string' ? value.id : '';
		if (!id) {
			continue;
		}

		const displayName = typeof value.displayName === 'string' ? value.displayName : id;
		const supportedScopes = Array.isArray(value.supportedScopes)
			? value.supportedScopes.filter(scope => scope === 'global' || scope === 'project')
			: ['global', 'project'];
		const supportedTransports = Array.isArray(value.supportedTransports)
			? value.supportedTransports.filter(
					transport => transport === 'stdio' || transport === 'http' || transport === 'sse'
			  )
			: ['stdio', 'http', 'sse'];

		result.push({
			id,
			displayName,
			supportedScopes: supportedScopes.length > 0 ? (supportedScopes as ScopeValue[]) : ['global', 'project'],
			supportedTransports:
				supportedTransports.length > 0 ? (supportedTransports as TransportValue[]) : ['stdio', 'http', 'sse']
		});
	}

	return result;
}

function inferTransport(serverSpec: string): TransportValue {
	const input = serverSpec.trim();
	if (/^https?:\/\//i.test(input)) {
		if (/\/sse(?:$|[/?#])/i.test(input)) {
			return 'sse';
		}
		return 'http';
	}

	return 'stdio';
}

function toForcedTransport(initialOptions: Record<string, unknown>): TransportValue | null {
	const transport = initialOptions.transport;
	if (transport === 'stdio' || transport === 'http' || transport === 'sse') {
		return transport;
	}
	return null;
}

function isScopeCompatible(agent: DetectedAgentOption, scope: ScopeValue): boolean {
	return agent.supportedScopes.includes(scope);
}

function isTransportCompatible(agent: DetectedAgentOption, transport: TransportValue): boolean {
	return agent.supportedTransports.includes(transport);
}

function incompatibilityReason(
	agent: DetectedAgentOption,
	scope: ScopeValue,
	transport: TransportValue
): string | null {
	if (!isScopeCompatible(agent, scope)) {
		return scope === 'project' ? 'global only' : 'project only';
	}

	if (!isTransportCompatible(agent, transport)) {
		if (agent.supportedTransports.length === 1) {
			return `${agent.supportedTransports[0]} only`;
		}

		return `${agent.supportedTransports.join('/')} only`;
	}

	return null;
}

function scopeToOptions(scope: ScopeValue): Record<string, unknown> {
	return {
		project: scope === 'project',
		global: scope !== 'project'
	};
}

function arraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) {
			return false;
		}
	}

	return true;
}

function MenuPrompt({title, description, options, defaultIndex = 0, onSubmit}: MenuPromptProps): React.JSX.Element {
	const [index, setIndex] = useState(() => Math.max(0, Math.min(defaultIndex, options.length - 1)));

	useInput((_input, key) => {
		if (options.length === 0) {
			return;
		}

		if (key.upArrow) {
			setIndex(current => (current - 1 + options.length) % options.length);
			return;
		}

		if (key.downArrow) {
			setIndex(current => (current + 1) % options.length);
			return;
		}

		if (key.return) {
			onSubmit(options[index]?.value ?? options[0]?.value ?? '');
		}
	});

	return (
		<Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
			<Text bold>{title}</Text>
			{description && <Text dimColor>{description}</Text>}
			<Box flexDirection="column">
				{options.map((option, optionIndex) => {
					const focused = optionIndex === index;
					return (
						<Text key={option.value} color={focused ? 'cyan' : undefined}>
							{focused ? '›' : ' '} {option.label}
							{option.hint ? ` (${option.hint})` : ''}
						</Text>
					);
				})}
			</Box>
			<Text dimColor>Use ↑/↓ and Enter.</Text>
		</Box>
	);
}

function TextPrompt({title, description, placeholder, defaultValue, inputKey, onSubmit}: TextPromptProps): React.JSX.Element {
	return (
		<Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
			<Text bold>{title}</Text>
			{description && <Text dimColor>{description}</Text>}
			<TextInput
				key={inputKey ?? title}
				defaultValue={defaultValue}
				onSubmit={onSubmit}
				placeholder={placeholder}
			/>
			<Text dimColor>Press Enter to continue.</Text>
		</Box>
	);
}

function LauncherApp({initialOptions, onDone}: LauncherAppProps): React.JSX.Element {
	const {exit} = useApp();
	const [step, setStep] = useState<LauncherStep>('action');
	const [serverSpec, setServerSpec] = useState('');
	const [serverName, setServerName] = useState(toString(initialOptions.name));
	const [authToken, setAuthToken] = useState(toString(initialOptions.authToken));
	const [oauthClientId, setOauthClientId] = useState(toString(initialOptions.oauthClientId));
	const [scope, setScope] = useState<ScopeValue>(toScope(initialOptions));
	const [agentSelectionError, setAgentSelectionError] = useState('');
	const [agentPickerSelection, setAgentPickerSelection] = useState<string[]>([]);
	const [agentPickerVersion, setAgentPickerVersion] = useState(0);
	const forcedTransport = toForcedTransport(initialOptions);
	const detectedAgents = useMemo(() => toDetectedAgents(initialOptions), [initialOptions]);
	const transport = useMemo<TransportValue>(
		() => forcedTransport ?? inferTransport(serverSpec),
		[forcedTransport, serverSpec]
	);
	const initialSelectedAgents = useMemo(() => {
		const fromOptions = toAgents(initialOptions);
		if (fromOptions.length > 0) {
			return fromOptions;
		}
		return detectedAgents.map(agent => agent.id);
	}, [detectedAgents, initialOptions]);
	const agentPickerModel = useMemo(() => {
		const optionMeta = detectedAgents.map(agent => {
			const reason = incompatibilityReason(agent, scope, transport);
			return {
				id: agent.id,
				label: reason
					? `${agent.displayName} (${agent.id}) [${reason}]`
					: `${agent.displayName} (${agent.id})`,
				compatible: reason === null
			};
		});
		const allAgentIds = optionMeta.map(entry => entry.id);
		const options = [
			{
				label: 'Select all agents',
				value: SELECT_ALL_VALUE
			},
			...optionMeta.map(entry => ({
				label: entry.label,
				value: entry.id
			}))
		];

		return {
			optionMeta,
			options,
			allAgentIds
		};
	}, [detectedAgents, scope, transport]);

	const finish = (result: LauncherResult | null): void => {
		onDone(result);
		exit();
	};

	useInput((input, key) => {
		if (key.escape || (input === 'c' && key.ctrl)) {
			finish(null);
		}
	});

	const actionOptions = useMemo<MenuOption[]>(
		() => [
			{label: 'Add MCP server', value: 'add'},
			{label: 'Remove MCP server', value: 'remove'},
			{label: 'List MCP servers', value: 'list'},
			{label: 'Detect installed agents', value: 'detect'},
			{label: 'Backup agent configs', value: 'backup'},
			{label: 'Restore from backup', value: 'restore'},
			{label: 'Quit', value: 'quit'}
		],
		[]
	);

	if (step === 'action') {
		return (
			<MenuPrompt
				description="Choose what to do. You can pass API keys directly in this flow."
				options={actionOptions}
				title="everymcp interactive wizard"
				onSubmit={value => {
					switch (value as ActionValue) {
						case 'add':
							setStep('addServerSpec');
							return;
						case 'remove':
							setStep('removeName');
							return;
						case 'list':
							setStep('listScope');
							return;
						case 'detect':
							finish({command: 'detect'});
							return;
						case 'backup':
							finish({command: 'backup'});
							return;
						case 'restore':
							setStep('restoreMode');
							return;
						case 'quit':
						default:
							finish(null);
					}
				}}
			/>
		);
	}

	if (step === 'addServerSpec') {
		return (
			<TextPrompt
				defaultValue={serverSpec}
				description='URL (e.g. https://mcp.context7.com/mcp) or stdio command.'
				inputKey='add-server-spec'
				placeholder='https://mcp.context7.com/mcp'
				title='Server spec'
				onSubmit={value => {
					const nextValue = value.trim();
					if (!nextValue) {
						return;
					}
					setServerSpec(nextValue);
					setStep('addName');
				}}
			/>
		);
	}

	if (step === 'addName') {
		return (
			<TextPrompt
				defaultValue={serverName}
				description='Optional. Leave blank to auto-name from URL/command.'
				inputKey='add-server-name'
				placeholder='context7'
				title='Server name (optional)'
				onSubmit={value => {
					setServerName(value.trim());
					setStep('addAuthToken');
				}}
			/>
		);
	}

	if (step === 'addAuthToken') {
		return (
			<TextPrompt
				defaultValue={authToken}
				description='Optional bearer token. Leave blank if not needed.'
				inputKey='add-auth-token'
				placeholder='ctx7sk-...'
				title='Auth token (optional)'
				onSubmit={value => {
					setAuthToken(value.trim());
					setStep('addOauthClientId');
				}}
			/>
		);
	}

	if (step === 'addOauthClientId') {
		return (
			<TextPrompt
				defaultValue={oauthClientId}
				description='Optional OAuth client ID. Leave blank if not needed.'
				inputKey='add-oauth-client-id'
				placeholder='my-oauth-client-id'
				title='OAuth client ID (optional)'
				onSubmit={value => {
					setOauthClientId(value.trim());
					setStep('addScope');
				}}
			/>
		);
	}

	if (step === 'addScope') {
		return (
			<MenuPrompt
				defaultIndex={scope === 'project' ? 1 : 0}
				options={[
					{label: 'Global', value: 'global'},
					{label: 'Project', value: 'project'}
				]}
				title='Target scope'
				onSubmit={value => {
					setScope(value === 'project' ? 'project' : 'global');
					setAgentPickerSelection([]);
					setAgentPickerVersion(current => current + 1);
					setStep('addTargetAgents');
				}}
			/>
		);
	}

	if (step === 'addTargetAgents') {
		const {optionMeta, options, allAgentIds} = agentPickerModel;

		return (
			<Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
				<Text bold>Target IDEs/agents</Text>
				<Text dimColor>Use ↑/↓ to move, Space to check/uncheck, Enter to install.</Text>
				<Text dimColor>All agents start unchecked. Select one or more before pressing Enter.</Text>
				<Text dimColor>Checking "Select all agents" checks everything; unchecking it clears everything.</Text>
				<Text dimColor>Entries marked with [...] are detected but incompatible with current scope/transport.</Text>
				{optionMeta.length === 0 ? (
					<Text color="yellow">No detected agents found.</Text>
				) : (
						<MultiSelect
							key={`agent-picker-${agentPickerVersion}-${scope}-${transport}`}
							defaultValue={agentPickerSelection}
							visibleOptionCount={Math.max(12, options.length)}
							options={options}
							onChange={selected => {
								const previousHadSelectAll = agentPickerSelection.includes(SELECT_ALL_VALUE);
								const nowHasSelectAll = selected.includes(SELECT_ALL_VALUE);
								let normalized: string[];

							if (previousHadSelectAll && !nowHasSelectAll) {
								normalized = [];
							} else if (!previousHadSelectAll && nowHasSelectAll) {
								normalized = [SELECT_ALL_VALUE, ...allAgentIds];
							} else {
								const selectedAgents = selected.filter(
									value => value !== SELECT_ALL_VALUE && allAgentIds.includes(value)
								);

									normalized =
										selectedAgents.length === allAgentIds.length
											? [SELECT_ALL_VALUE, ...allAgentIds]
											: selectedAgents;
								}

								if (!arraysEqual(agentPickerSelection, normalized)) {
									setAgentPickerSelection(normalized);
								}
								if (!arraysEqual(normalized, selected)) {
									setAgentPickerVersion(current => current + 1);
								}
							}}
						onSubmit={selected => {
							const selectedCompatible = selected
								.filter(value => value !== SELECT_ALL_VALUE)
								.filter(
								id => optionMeta.find(option => option.id === id)?.compatible === true
							);

							if (selectedCompatible.length === 0) {
								setAgentSelectionError('Select at least one agent before continuing.');
								return;
							}

							setAgentSelectionError('');
							finish({
								command: 'add',
								args: [serverSpec],
								options: {
									...scopeToOptions(scope),
									dryRun: false,
									all: false,
									agents: selectedCompatible,
									name: serverName || undefined,
									authToken: authToken || undefined,
									oauthClientId: oauthClientId || undefined
								}
							});
						}}
					/>
				)}
				{agentSelectionError ? <Text color="yellow">{agentSelectionError}</Text> : null}
				{optionMeta.length === 0 ? (
					<Text dimColor>
						Press Esc to cancel, or go back and change server type/scope.
					</Text>
				) : null}
			</Box>
		);
	}

	if (step === 'removeName') {
		return (
			<TextPrompt
				description='Enter the MCP server name to remove.'
				inputKey='remove-server-name'
				placeholder='context7'
				title='Server name'
				onSubmit={value => {
					const nextValue = value.trim();
					if (!nextValue) {
						return;
					}
					setServerName(nextValue);
					setStep('removeScope');
				}}
			/>
		);
	}

	if (step === 'removeScope') {
		return (
			<MenuPrompt
				defaultIndex={scope === 'project' ? 1 : 0}
				options={[
					{label: 'Global', value: 'global'},
					{label: 'Project', value: 'project'}
				]}
				title='Target scope'
				onSubmit={value => {
					const nextScope: ScopeValue = value === 'project' ? 'project' : 'global';
					setScope(nextScope);
					finish({
						command: 'remove',
						args: [serverName],
						options: {
							...scopeToOptions(nextScope),
							dryRun: false
						}
					});
				}}
			/>
		);
	}

	if (step === 'listScope') {
		return (
			<MenuPrompt
				defaultIndex={scope === 'project' ? 1 : 0}
				options={[
					{label: 'Global', value: 'global'},
					{label: 'Project', value: 'project'}
				]}
				title='List scope'
				onSubmit={value => {
					const nextScope = value === 'project' ? 'project' : 'global';
					setScope(nextScope);
					finish({
						command: 'list',
						options: scopeToOptions(nextScope)
					});
				}}
			/>
		);
	}

	if (step === 'restoreMode') {
		return (
			<MenuPrompt
				options={[
					{label: 'Pick backup interactively', value: 'interactive'},
					{label: 'Use latest backup', value: 'latest'}
				]}
				title='Restore mode'
				onSubmit={value => {
					finish({
						command: 'restore',
						options: {
							latest: value === 'latest'
						}
					});
				}}
			/>
		);
	}

	return <Text color="yellow">Unknown wizard state. Press Esc to quit.</Text>;
}

export async function runInteractiveLauncher(initialOptions: Record<string, unknown> = {}): Promise<LauncherResult | null> {
	await printBanner();

	return new Promise((resolve, reject) => {
		let settled = false;
		const instance = render(
			<LauncherApp
				initialOptions={initialOptions}
				onDone={result => {
					if (settled) {
						return;
					}
					settled = true;
					resolve(result);
				}}
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
