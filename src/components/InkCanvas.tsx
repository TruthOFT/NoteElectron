import { useState } from 'react';
import {
  ActionIcon,
  ColorSwatch,
  Divider,
  Group,
  Paper,
  Popover,
  Slider,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconArrowBackUp, IconPencil, IconTrash } from '@tabler/icons-react';
import useInkCanvas from '../ink/input/useInkCanvas';
import './InkCanvas.css';

const COLORS = ['#111827', '#4263eb', '#0ca678', '#e03131', '#9c36b5'];

export default function InkCanvas() {
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(8);
  const [sharpness, setSharpness] = useState(75);
  const [pressureSensitivity, setPressureSensitivity] = useState(55);
  const {
    canvasRef,
    previewCanvasRef,
    cursorRef,
    canUndo,
    undo,
    clear,
  } = useInkCanvas({ color, brushSize, sharpness, pressureSensitivity });

  return (
    <Paper className="ink-panel" radius="xl" withBorder>
      <div className="ink-toolbar">
        <Group gap="sm" wrap="nowrap">
          <Popover width={310} position="bottom-start" shadow="md" withArrow>
            <Popover.Target>
              <ActionIcon variant="light" size="lg" radius="md" aria-label="钢笔设置">
                <IconPencil size={20} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown className="brush-settings">
              <Text fw={700} mb="md">钢笔参数</Text>
              <Stack gap="lg">
                <div>
                  <Group justify="space-between" mb={6}>
                    <Text size="sm">笔尖锐度</Text>
                    <Text size="xs" c="dimmed">{sharpness}%</Text>
                  </Group>
                  <Slider
                    value={sharpness}
                    onChange={setSharpness}
                    min={0}
                    max={100}
                    step={5}
                    label={(value) => `${value}%`}
                    aria-label="笔尖锐度"
                  />
                </div>
                <div>
                  <Group justify="space-between" mb={6}>
                    <Text size="sm">压力灵敏度</Text>
                    <Text size="xs" c="dimmed">{pressureSensitivity}% · 越小越省力</Text>
                  </Group>
                  <Slider
                    value={pressureSensitivity}
                    onChange={setPressureSensitivity}
                    min={0}
                    max={100}
                    step={5}
                    label={(value) => `${value}%`}
                    aria-label="压力灵敏度"
                  />
                </div>
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <Divider orientation="vertical" />
          <Group gap={7} wrap="nowrap">
            {COLORS.map((item) => (
              <ColorSwatch
                className="ink-color"
                component="button"
                color={item}
                key={item}
                onClick={() => setColor(item)}
                size={color === item ? 25 : 21}
                aria-label={`选择颜色 ${item}`}
              />
            ))}
          </Group>
          <Divider orientation="vertical" />
          <Text size="xs" c="dimmed" w={38}>{brushSize}px</Text>
          <Slider
            value={brushSize}
            onChange={setBrushSize}
            min={2}
            max={24}
            step={1}
            w={150}
            size="sm"
            aria-label="笔刷粗细"
          />
        </Group>

        <Group gap={4} wrap="nowrap">
          <Tooltip label="撤销">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={undo}
              disabled={!canUndo}
              aria-label="撤销"
            >
              <IconArrowBackUp size={20} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="清空画布">
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              onClick={clear}
              disabled={!canUndo}
              aria-label="清空画布"
            >
              <IconTrash size={19} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <div className="canvas-stage">
        <canvas ref={canvasRef} className="ink-canvas ink-base-canvas" />
        <canvas ref={previewCanvasRef} className="ink-canvas ink-preview-canvas" />
        <div ref={cursorRef} className="brush-cursor" />
      </div>
    </Paper>
  );
}
