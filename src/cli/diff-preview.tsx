import { createRequire } from 'node:module';
import { Box, Text } from 'ink';
import type { ConfigChange } from '../types/index.js';

interface DiffPreviewProps {
  changes: ConfigChange[];
}

const hasDiff = (before: string, after: string): boolean => {
  if (before === after) {
    return false;
  }

  return before.length > 0 || after.length > 0;
};

const renderLine = (line: string, index: number) => {
  if (line.startsWith('@@')) {
    return (
      <Text color="cyan" key={`${line}-${index}`}>
        {line}
      </Text>
    );
  }

  if (line.startsWith('+') && !line.startsWith('+++')) {
    return (
      <Text color="green" key={`${line}-${index}`}>
        {line}
      </Text>
    );
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return (
      <Text color="red" key={`${line}-${index}`}>
        {line}
      </Text>
    );
  }

  return (
    <Text key={`${line}-${index}`}>
      {line}
    </Text>
  );
};

const requireDiff = createRequire(import.meta.url);

type DiffPatchFn = (
  fileName: string,
  oldStr: string,
  newStr: string,
  oldHeader: string,
  newHeader: string,
  options?: { context?: number },
) => string;

const getCreatePatch = (): DiffPatchFn => {
  const diffModule = requireDiff('diff');

  if (typeof diffModule.createPatch !== 'function') {
    return (): string => '';
  }

  return diffModule.createPatch as DiffPatchFn;
};

const renderUnifiedDiff = (change: ConfigChange) => {
  if (!hasDiff(change.before, change.after)) {
    return <Text dimColor>No diff for this change.</Text>;
  }

  const createPatch = getCreatePatch();
  const patch = createPatch(change.configPath, change.before, change.after, 'before', 'after', {
    context: 3,
  });

  return (
    <Box flexDirection="column" gap={0}>
      {patch.split('\n').map((line, index) => renderLine(line, index))}
    </Box>
  );
};

export function DiffPreview({ changes }: DiffPreviewProps) {
  if (changes.length === 0) {
    return <Text>No changes to preview.</Text>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {changes.map((change) => {
        return (
          <Box key={`${change.agent}-${change.configPath}`} borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
            <Text bold>
              {change.agent} · {change.configPath}
            </Text>
            <Text>
              {change.action === 'add' ? 'Add' : 'Remove'} server
              <Text color="yellow"> {change.serverName}</Text>
            </Text>
            {change.warning ? <Text color="yellow">Warning: {change.warning}</Text> : null}
            <Box marginTop={1} flexDirection="column" gap={0}>
              {renderUnifiedDiff(change)}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
