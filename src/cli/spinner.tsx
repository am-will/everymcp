import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';

export interface SpinnerAgentStatus {
  name: string;
  status: 'pending' | 'done' | 'error';
  warning?: string;
}

interface SpinnerPanelProps {
  message: string;
  agents: SpinnerAgentStatus[];
}

const statusIcon = (status: SpinnerAgentStatus['status'], hasWarning?: boolean): string => {
  if (hasWarning && status === 'done') {
    return '⚠';
  }

  if (status === 'error') {
    return '✗';
  }

  if (status === 'done') {
    return '✓';
  }

  return '…';
};

const statusColor = (
  status: SpinnerAgentStatus['status'],
  hasWarning?: boolean,
): 'yellow' | 'red' | 'green' | 'blue' | undefined => {
  if (hasWarning && status === 'done') {
    return 'yellow';
  }

  if (status === 'error') {
    return 'red';
  }

  if (status === 'done') {
    return 'green';
  }

  return 'blue';
};

export function SpinnerPanel({ message, agents }: SpinnerPanelProps) {
  const hasPending = agents.some((agent) => agent.status === 'pending');

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        {hasPending ? <Spinner label={message} /> : <Text bold>{message}</Text>}
      </Box>
      <Box flexDirection="column" gap={0}>
        {agents.map((agent) => {
          const color = statusColor(agent.status, Boolean(agent.warning));
          return (
            <Text key={agent.name} color={color}>
              {statusIcon(agent.status, Boolean(agent.warning))} {agent.name}{' '}
              {agent.warning ? <Text color="yellow">{agent.warning}</Text> : null}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
