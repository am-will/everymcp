import { Box, Text } from 'ink';
import { printBanner } from './banner.js';
import type { ConfigScope, ConfigChange, DetectedAgent, TransportType } from '../types/index.js';
import { DiffPreview } from './diff-preview.js';
import { SpinnerPanel, SpinnerAgentStatus } from './spinner.js';
import { Wizard } from './wizard.js';

await printBanner();

interface AppSummaryEntry {
  name: string;
  status: 'pending' | 'done' | 'error';
  warning?: string;
}

interface AppCommonProps {
  detectedAgents: DetectedAgent[];
  scope: ConfigScope;
  transport: TransportType;
}

interface SelectionFlowProps extends AppCommonProps {
  mode: 'selection';
  onSubmit: (selectedAgentIds: string[]) => void;
}

interface PreviewFlowProps extends AppCommonProps {
  mode: 'preview';
  changes: ConfigChange[];
}

interface SpinnerFlowProps extends AppCommonProps {
  mode: 'spinner';
  message: string;
  agents: SpinnerAgentStatus[];
}

interface SummaryFlowProps extends AppCommonProps {
  mode: 'summary';
  entries: AppSummaryEntry[];
}

type AppProps = SelectionFlowProps | PreviewFlowProps | SpinnerFlowProps | SummaryFlowProps;

const detectedSummary = (agents: DetectedAgent[]): string => {
  const detectedCount = agents.filter((agent) => agent.detected).length;
  const totalCount = agents.length;

  if (detectedCount === totalCount) {
    return `${detectedCount} detected`;
  }

  return `${detectedCount}/${totalCount} detected`;
};

const completionSummary = (entries: AppSummaryEntry[]) => {
  const done = entries.filter((entry) => entry.status === 'done').length;
  const warned = entries.filter((entry) => entry.warning).length;
  const errored = entries.filter((entry) => entry.status === 'error').length;

  const lines = [`Completed: ${done}, Warnings: ${warned}, Errors: ${errored}`];

  entries.forEach((entry) => {
    if (entry.warning) {
      lines.push(`${entry.name}: ${entry.warning}`);
    }
  });

  return lines;
};

export function App(props: AppProps) {
  const detectedAgents = props.detectedAgents;

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>everymcp</Text>
      <Text dimColor>
        {detectedSummary(detectedAgents)} · scope: {props.scope} · transport: {props.transport}
      </Text>

      {props.mode === 'selection' ? (
        <Wizard
          detectedAgents={props.detectedAgents}
          scope={props.scope}
          transport={props.transport}
          onSubmit={props.onSubmit}
        />
      ) : null}

      {props.mode === 'preview' ? <DiffPreview changes={props.changes} /> : null}

      {props.mode === 'spinner' ? (
        <SpinnerPanel message={props.message} agents={props.agents} />
      ) : null}

      {props.mode === 'summary' ? (
        <>
          <Text bold>Summary</Text>
          {completionSummary(props.entries).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </>
      ) : null}
    </Box>
  );
}
