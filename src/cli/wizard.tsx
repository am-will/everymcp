import chalk from 'chalk';
import { Box, Text } from 'ink';
import { MultiSelect } from '@inkjs/ui';
import type { ConfigScope, DetectedAgent, TransportType } from '../types/index.js';

interface WizardProps {
  detectedAgents: DetectedAgent[];
  scope: ConfigScope;
  transport: TransportType;
  onSubmit: (selected: string[]) => void;
}

interface WizardOption {
  label: string;
  value: string;
}

interface WizardEntry {
  id: string;
  label: string;
  compatible: boolean;
}

const describeScopeIssue = (scopes: readonly ConfigScope[], scope: ConfigScope): string | null => {
  if (scopes.includes(scope)) {
    return null;
  }

  if (scope === 'project') {
    return 'global only';
  }

  return 'project only';
};

const describeTransportIssue = (transports: readonly TransportType[], transport: TransportType): string | null => {
  if (transports.includes(transport)) {
    return null;
  }

  const supportedCount = transports.length;

  if (supportedCount === 0) {
    return 'unsupported transport';
  }

  if (supportedCount === 1) {
    return `${transports[0]} only`;
  }

  return `${transports.join(' / ')} only`;
};

const formatPath = (agent: DetectedAgent): string => {
  if (agent.configPaths.length === 0) {
    return 'No config path';
  }

  return agent.configPaths
    .map((entry: { scope: ConfigScope; path: string; exists: boolean }) => {
      return `${entry.scope}: ${entry.path}${entry.exists ? '' : ' (missing)'}`;
    })
    .join(' · ');
};

const formatCompatibility = (
  adapter: { supportedScopes: readonly ConfigScope[]; supportedTransports: readonly TransportType[] },
  scope: ConfigScope,
  transport: TransportType,
): string | null => {
  const scopeIssue = describeScopeIssue(adapter.supportedScopes, scope);
  const transportIssue = describeTransportIssue(adapter.supportedTransports, transport);

  if (scopeIssue === null && transportIssue === null) {
    return null;
  }

  if (scopeIssue && transportIssue) {
    return `${scopeIssue}; ${transportIssue}`;
  }

  return scopeIssue ?? transportIssue;
};

export function Wizard({ detectedAgents, scope, transport, onSubmit }: WizardProps) {
  const entries: WizardEntry[] = detectedAgents.map((agent: DetectedAgent) => {
    const compatible =
      agent.adapter.supportedScopes.includes(scope) &&
      agent.adapter.supportedTransports.includes(transport);

    const compatibilityIssue = formatCompatibility(agent.adapter, scope, transport);

    const rawLabel = `${agent.adapter.displayName} (${formatPath(agent)})${
      compatibilityIssue ? ` (${compatibilityIssue})` : ''
    }`;

    return {
      id: agent.adapter.id,
      label: compatible ? rawLabel : chalk.dim(rawLabel),
      compatible,
    };
  });

  const options: WizardOption[] = entries.map((entry: WizardEntry) => ({
    value: entry.id,
    label: entry.label,
  }));

  const defaultValue = detectedAgents.map((agent: DetectedAgent) => agent.adapter.id);
  const compatibleSet = new Set(entries.filter((entry) => entry.compatible).map((entry) => entry.id));

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Detected agents</Text>
      <MultiSelect
        defaultValue={defaultValue}
        options={options}
        onSubmit={(selected: string[]) => {
          const finalSelection = selected.filter((id: string) => compatibleSet.has(id));
          onSubmit(finalSelection);
        }}
      />
      <Text dimColor>
        Incompatible agents are dimmed and will be skipped.
      </Text>
    </Box>
  );
}
