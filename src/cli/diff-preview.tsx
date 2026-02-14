import React from 'react';
import {Box, Text} from 'ink';
import {createPatch} from 'diff';
import type {ConfigChange} from '../types/index.js';

export interface DiffPreviewProps {
	changes: ConfigChange[];
}

function getLineColor(line: string): 'green' | 'red' | 'cyan' | 'yellow' | undefined {
	if (line.startsWith('+++') || line.startsWith('---')) {
		return 'cyan';
	}

	if (line.startsWith('@@')) {
		return 'yellow';
	}

	if (line.startsWith('+')) {
		return 'green';
	}

	if (line.startsWith('-')) {
		return 'red';
	}

	return undefined;
}

function renderUnifiedDiff(change: ConfigChange): React.JSX.Element[] {
	const patch = createPatch(
		change.configPath,
		change.before ?? '',
		change.after ?? '',
		'before',
		'after',
		{context: 3}
	);

	return patch.split('\n').map((line, index) => (
		<Text color={getLineColor(line)} key={`${change.agent}-line-${index}`}>
			{line.length > 0 ? line : ' '}
		</Text>
	));
}

export function DiffPreview({changes}: DiffPreviewProps): React.JSX.Element {
	if (changes.length === 0) {
		return <Text dimColor>No config changes to preview.</Text>;
	}

	return (
		<Box flexDirection="column" gap={1}>
			{changes.map(change => (
				<Box
					borderColor="gray"
					borderStyle="round"
					flexDirection="column"
					key={`${change.agent}-${change.configPath}`}
					paddingX={1}
					paddingY={0}
				>
					<Text bold>
						{change.agent}: {change.configPath}
					</Text>
					<Text dimColor>
						Action: {change.action} `{change.serverName}`
					</Text>
					{change.warning && <Text color="yellow">Warning: {change.warning}</Text>}
					<Box flexDirection="column" marginTop={1}>
						{renderUnifiedDiff(change)}
					</Box>
				</Box>
			))}
		</Box>
	);
}
