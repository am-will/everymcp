import React, {useMemo} from 'react';
import {Box, Text} from 'ink';
import {MultiSelect} from '@inkjs/ui';
import type {ConfigScope, DetectedAgent, TransportType} from '../types/index.js';

export interface WizardProps {
	detectedAgents: DetectedAgent[];
	scope: ConfigScope;
	transport: TransportType;
	onSubmit: (selected: string[]) => void;
}

interface AgentChoice {
	id: string;
	label: string;
	reason?: string;
}

function getScopePath(agent: DetectedAgent, scope: ConfigScope): string {
	return agent.configPaths.find(pathInfo => pathInfo.scope === scope)?.path ?? agent.configPaths[0]?.path ?? 'no config path';
}

function getIncompatibilityReason(
	agent: DetectedAgent,
	scope: ConfigScope,
	transport: TransportType
): string | undefined {
	const scopeSupported = agent.adapter.supportedScopes.includes(scope);
	const transportSupported = agent.adapter.supportedTransports.includes(transport);

	if (scopeSupported && transportSupported) {
		return undefined;
	}

	const reasons: string[] = [];

	if (!scopeSupported) {
		reasons.push(`${scope} scope unsupported`);
	}

	if (!transportSupported) {
		reasons.push(`${transport} transport unsupported`);
	}

	return reasons.join(', ');
}

export function Wizard({detectedAgents, scope, transport, onSubmit}: WizardProps): React.JSX.Element {
	const choices = useMemo<AgentChoice[]>(() => {
		return detectedAgents.map(agent => {
			const configPath = getScopePath(agent, scope);
			const reason = getIncompatibilityReason(agent, scope, transport);
			const suffix = reason ? ` (${reason})` : '';
			return {
				id: agent.adapter.id,
				label: `${agent.adapter.displayName} - ${configPath}${suffix}`,
				reason
			};
		});
	}, [detectedAgents, scope, transport]);

	const selectable = choices.filter(choice => !choice.reason);
	const incompatible = choices.filter(choice => choice.reason);
	const defaultSelection = selectable.map(choice => choice.id);

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>Select target agents</Text>
			<Text dimColor>Use arrow keys to navigate, space to toggle, and Enter to submit.</Text>

			{selectable.length === 0 ? (
				<Text color="yellow">No agents are compatible with the chosen scope and transport.</Text>
			) : (
				<MultiSelect
					defaultValue={defaultSelection}
					options={selectable.map(choice => ({
						label: choice.label,
						value: choice.id
					}))}
					onSubmit={value => {
						onSubmit(value);
					}}
				/>
			)}

			{incompatible.length > 0 && (
				<Box flexDirection="column">
					<Text color="yellow">Unavailable for this run:</Text>
					{incompatible.map(choice => (
						<Text dimColor key={choice.id}>
							- {choice.label}
						</Text>
					))}
				</Box>
			)}
		</Box>
	);
}
