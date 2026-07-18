import { useState } from 'react';
import { ActionIcon, Group, Paper, Text } from '@mantine/core';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import useInkCanvas from '../ink/input/useInkCanvas';
import FloatingInkToolbar from './FloatingInkToolbar';
import './InkCanvas.css';

const COLORS = ['#111827', '#4263eb', '#0ca678', '#e03131', '#9c36b5'];

export default function InkCanvas() {
  const [color, setColor] = useState(COLORS[0]);
  const [brushPresets, setBrushPresets] = useState([4, 8, 14]);
  const [selectedBrushPreset, setSelectedBrushPreset] = useState(1);
  const [sharpness, setSharpness] = useState(75);
  const [pressureSensitivity, setPressureSensitivity] = useState(55);
  const brushSize = brushPresets[selectedBrushPreset];

  const updateBrushPresetSize = (index: number, value: number) => {
    setBrushPresets((current) => current.map((size, presetIndex) => (
      presetIndex === index ? value : size
    )));
  };
  const {
    canvasRef,
    previewCanvasRef,
    cursorRef,
    canUndo,
    zoom,
    zoomControlsVisible,
    canZoomIn,
    canZoomOut,
    zoomIn,
    zoomOut,
    undo,
    clear,
  } = useInkCanvas({ color, brushSize, sharpness, pressureSensitivity });

  return (
    <div className="ink-panel">
      <FloatingInkToolbar
        colors={COLORS}
        color={color}
        brushPresets={brushPresets}
        selectedBrushPreset={selectedBrushPreset}
        sharpness={sharpness}
        pressureSensitivity={pressureSensitivity}
        canUndo={canUndo}
        onColorChange={setColor}
        onBrushPresetSelect={setSelectedBrushPreset}
        onBrushPresetSizeChange={updateBrushPresetSize}
        onSharpnessChange={setSharpness}
        onPressureSensitivityChange={setPressureSensitivity}
        onUndo={undo}
        onClear={clear}
      />

      <div className="canvas-stage">
        <canvas ref={canvasRef} className="ink-canvas ink-base-canvas" />
        <canvas ref={previewCanvasRef} className="ink-canvas ink-preview-canvas" />
        <div ref={cursorRef} className="brush-cursor" />
      </div>

      <Paper
        className="zoom-controls"
        data-visible={zoomControlsVisible ? 'true' : 'false'}
        radius="xl"
        shadow="md"
        withBorder
        aria-hidden={!zoomControlsVisible}
      >
        <Group gap={4} wrap="nowrap">
          <ActionIcon
            variant="subtle"
            color="gray"
            radius="xl"
            onClick={zoomOut}
            disabled={!canZoomOut}
            aria-label="缩小画布"
          >
            <IconMinus size={17} />
          </ActionIcon>
          <Text className="zoom-value" size="sm" fw={650} ta="center">
            {Math.round(zoom * 100)}%
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            radius="xl"
            onClick={zoomIn}
            disabled={!canZoomIn}
            aria-label="放大画布"
          >
            <IconPlus size={17} />
          </ActionIcon>
        </Group>
      </Paper>
    </div>
  );
}
