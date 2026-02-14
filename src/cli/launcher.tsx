import React, {useMemo, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {TextInput} from '@inkjs/ui';
import {printBanner} from './banner.js';

type ScopeValue = 'global' | 'project';
type YesNo = 'yes' | 'no';

type LauncherStep =
	| 'action'
	| 'addServerSpec'
	| 'addName'
	| 'addAuthToken'
	| 'addScope'
	| 'addDryRun'
	| 'removeName'
	| 'removeScope'
	| 'removeDryRun'
	| 'listScope'
	| 'restoreMode';

type ActionValue = 'add' | 'remove' | 'list' | 'detect' | 'backup' | 'restore' | 'quit';

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
	onSubmit: (value: string) => void;
}

interface LauncherAppProps {
	initialOptions: Record<string, unknown>;
	onDone: (result: LauncherResult | null) => void;
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

function scopeToOptions(scope: ScopeValue): Record<string, unknown> {
	return {
		project: scope === 'project',
		global: scope !== 'project'
	};
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
		<Box flexDirection="column" gap={1}>
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

function TextPrompt({title, description, placeholder, defaultValue, onSubmit}: TextPromptProps): React.JSX.Element {
	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>{title}</Text>
			{description && <Text dimColor>{description}</Text>}
			<TextInput defaultValue={defaultValue} onSubmit={onSubmit} placeholder={placeholder} />
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
	const [scope, setScope] = useState<ScopeValue>(toScope(initialOptions));
	const [dryRun, setDryRun] = useState<boolean>(toBoolean(initialOptions.dryRun, false));

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
				placeholder='ctx7sk-...'
				title='Auth token (optional)'
				onSubmit={value => {
					setAuthToken(value.trim());
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
					setStep('addDryRun');
				}}
			/>
		);
	}

	if (step === 'addDryRun') {
		return (
			<MenuPrompt
				defaultIndex={dryRun ? 0 : 1}
				options={[
					{label: 'Yes', value: 'yes', hint: 'preview only'},
					{label: 'No', value: 'no', hint: 'apply changes'}
				]}
				title='Dry run?'
				onSubmit={value => {
					const nextDryRun = value === 'yes';
					setDryRun(nextDryRun);
					finish({
						command: 'add',
						args: [serverSpec],
						options: {
							...scopeToOptions(scope),
							dryRun: nextDryRun,
							name: serverName || undefined,
							authToken: authToken || undefined
						}
					});
				}}
			/>
		);
	}

	if (step === 'removeName') {
		return (
			<TextPrompt
				description='Enter the MCP server name to remove.'
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
					setScope(value === 'project' ? 'project' : 'global');
					setStep('removeDryRun');
				}}
			/>
		);
	}

	if (step === 'removeDryRun') {
		return (
			<MenuPrompt
				defaultIndex={dryRun ? 0 : 1}
				options={[
					{label: 'Yes', value: 'yes', hint: 'preview only'},
					{label: 'No', value: 'no', hint: 'apply changes'}
				]}
				title='Dry run?'
				onSubmit={value => {
					const nextDryRun = value === 'yes';
					setDryRun(nextDryRun);
					finish({
						command: 'remove',
						args: [serverName],
						options: {
							...scopeToOptions(scope),
							dryRun: nextDryRun
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
