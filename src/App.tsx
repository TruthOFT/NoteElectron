import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Group,
  NavLink,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconBell,
  IconClock,
  IconFileText,
  IconNotes,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconStar,
  IconTrash,
} from '@tabler/icons-react';
import './App.css';

const notes = [
  { title: '手写笔记设计', detail: '整理画布、笔工具和页面结构', time: '刚刚', color: 'indigo' },
  { title: 'React 学习记录', detail: '组件状态、事件与数据流', time: '昨天', color: 'cyan' },
  { title: '灵感收集', detail: '产品细节和交互想法', time: '7 月 16 日', color: 'grape' },
];

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Group gap="sm" px="md" mb={28}>
          <ThemeIcon size={38} radius="md" variant="gradient" gradient={{ from: 'indigo', to: 'cyan', deg: 135 }}>
            <IconNotes size={22} stroke={2.2} />
          </ThemeIcon>
          <div>
            <Text fw={750} size="lg" lh={1.1}>Note</Text>
            <Text size="xs" c="dimmed">个人知识空间</Text>
          </div>
        </Group>

        <Button fullWidth leftSection={<IconPlus size={18} />} size="md" radius="md" mb="xl">
          新建笔记
        </Button>

        <Stack gap={4}>
          <NavLink label="全部笔记" leftSection={<IconFileText size={19} />} active variant="light" />
          <NavLink label="最近使用" leftSection={<IconClock size={19} />} />
          <NavLink label="我的收藏" leftSection={<IconStar size={19} />} />
          <NavLink label="回收站" leftSection={<IconTrash size={19} />} />
        </Stack>

        <Paper className="upgrade-card" radius="lg" p="md" mt="auto">
          <ThemeIcon variant="light" color="indigo" radius="xl" mb="sm">
            <IconSparkles size={17} />
          </ThemeIcon>
          <Text fw={700} size="sm">开始创作</Text>
          <Text size="xs" c="dimmed" mt={4}>画布模块可以从这里继续接入。</Text>
        </Paper>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <TextInput
            className="search"
            placeholder="搜索笔记"
            leftSection={<IconSearch size={18} />}
            size="md"
            radius="md"
          />
          <Group gap="xs">
            <Tooltip label="通知">
              <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="通知">
                <IconBell size={20} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="设置">
              <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="设置">
                <IconSettings size={20} />
              </ActionIcon>
            </Tooltip>
            <Avatar color="indigo" radius="xl" size={36}>H</Avatar>
          </Group>
        </header>

        <section className="content">
          <Paper className="hero" radius="xl" p={{ base: 'xl', md: 34 }}>
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="xl">
              <div>
                <Badge variant="light" color="indigo" mb="md">Electron + React</Badge>
                <Title order={1}>下午好，Haze</Title>
                <Text c="dimmed" mt="xs">继续记录想法，或者创建一页新的手写笔记。</Text>
              </div>
              <Button leftSection={<IconPlus size={18} />} size="md" radius="md">
                创建新页面
              </Button>
            </Group>
          </Paper>

          <Group justify="space-between" mt={34} mb="md">
            <div>
              <Title order={3}>最近笔记</Title>
              <Text size="sm" c="dimmed">快速回到上次编辑的位置</Text>
            </div>
            <Button variant="subtle" color="gray">查看全部</Button>
          </Group>

          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
            {notes.map((note) => (
              <Paper className="note-card" key={note.title} radius="lg" p="lg" withBorder>
                <Group justify="space-between" mb={34}>
                  <ThemeIcon color={note.color} variant="light" size={40} radius="md">
                    <IconFileText size={21} />
                  </ThemeIcon>
                  <Text size="xs" c="dimmed">{note.time}</Text>
                </Group>
                <Text fw={700}>{note.title}</Text>
                <Text size="sm" c="dimmed" mt={5}>{note.detail}</Text>
              </Paper>
            ))}
          </SimpleGrid>
        </section>
      </main>
    </div>
  );
}
