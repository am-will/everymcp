import React from 'react';
import {Box, Text} from 'ink';
import {Spinner} from '@inkjs/ui';

export type AgentProgressStatus = 'pending' | 'done' | 'error';

export interface AgentProgressItem {
	name: string;
	status: AgentProgressStatus;
	warning?: string;
}

export interface ProgressSpinnerProps {
	message: string;
	agents: AgentProgressItem[];
}

function getIcon(agent: AgentProgressItem): string {
	if (agent.status === 'done') {
		return '✓';
	}

	if (agent.status === 'error') {
		return '✗';
	}

	if (agent.warning) {
		return '⚠';
	}

	return '…';
}

function getIconColor(agent: AgentProgressItem): 'green' | 'red' | 'yellow' | 'cyan' {
	if (agent.status === 'done') {
		return 'green';
	}

	if (agent.status === 'error') {
		return 'red';
	}

	if (agent.warning) {
		return 'yellow';
	}

	return 'cyan';
}

export function ProgressSpinner({message, agents}: ProgressSpinnerProps): React.JSX.Element {
	const hasPending = agents.some(agent => agent.status === 'pending');
	const postInstallMessages = agents
		.filter(agent => agent.warning && agent.status !== 'error')
		.map(agent => `${agent.name}: ${agent.warning as string}`);

	return (
		<Box flexDirection="column" gap={1}>
			{hasPending ? <Spinner label={message} /> : <Text color="green">✓ {message}</Text>}

			<Box flexDirection="column">
				{agents.map(agent => (
					<Box key={agent.name}>
						<Text color={getIconColor(agent)}>{getIcon(agent)} </Text>
						<Text>{agent.name}</Text>
						{agent.warning && <Text color="yellow"> ({agent.warning})</Text>}
					</Box>
				))}
			</Box>

			{postInstallMessages.length > 0 && (
				<Box flexDirection="column">
					<Text color="yellow">Post-install actions:</Text>
					{postInstallMessages.map(note => (
						<Text key={note}>- {note}</Text>
					))}
				</Box>
			)}
		</Box>
	);
}
