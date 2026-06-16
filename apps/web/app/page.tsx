'use client';

import {
  ApiOutlined,
  BellOutlined,
  CloudServerOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  KeyOutlined,
  LineChartOutlined,
  PictureOutlined
} from '@ant-design/icons';
import { Alert, Card, Col, Empty, List, Row, Space, Spin, Statistic, Typography } from 'antd';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from './components/console-shell';
import { listPublishedAnnouncements } from './lib/announcements-api';
import type { AnnouncementFeedResponse, AnnouncementSection } from './lib/announcements-api';

const documentEntries = [
  { title: '令牌管理', href: '/token', icon: <KeyOutlined /> },
  { title: '费用说明', href: '/pricing', icon: <CreditCardOutlined /> },
  { title: '调用日志', href: '/log', icon: <FileTextOutlined /> },
  { title: '绘图', href: '/midjourney', icon: <PictureOutlined /> },
  { title: '余额充值', href: '/account/topup/recharge', icon: <CreditCardOutlined /> },
  { title: '分组状态', href: '/groupAvailability', icon: <LineChartOutlined /> },
  { title: '服务状态', href: '/uptimeStatus', icon: <CloudServerOutlined /> },
  { title: '通知设置', href: '/account/notificationSettings', icon: <BellOutlined /> }
];

const emptyFeed: AnnouncementFeedResponse = {
  generatedAt: '',
  total: 0,
  sections: [
    { key: 'announcement', title: '平台公告', items: [] },
    { key: 'update_log', title: '更新日志', items: [] },
    { key: 'usage_guide', title: '使用建议', items: [] }
  ]
};

export default function HomePage() {
  const [feed, setFeed] = useState<AnnouncementFeedResponse>(emptyFeed);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadAnnouncements() {
      setIsLoading(true);
      setError('');

      try {
        const nextFeed = await listPublishedAnnouncements();
        if (!cancelled) {
          setFeed(nextFeed);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '公告加载失败');
          setFeed(emptyFeed);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAnnouncements();

    return () => {
      cancelled = true;
    };
  }, []);

  const latestPublishedAt = useMemo(() => {
    const publishedTimes = feed.sections
      .flatMap((section) => section.items)
      .map((item) => item.publishedAt ?? item.createdAt)
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());

    return publishedTimes[0] ? formatDate(publishedTimes[0]) : '暂无';
  }, [feed.sections]);

  return (
    <ConsoleShell activePath="/">
      <section className="profile-card account-summary">
        <div>
          <p className="eyebrow">首页</p>
          <h1>中转站控制台</h1>
          <p className="page-subtitle">
            <ApiOutlined /> 智能服务中转后台
          </p>
        </div>
      </section>

      <Space orientation="vertical" size={20} style={{ width: '100%' }}>
        {error ? <Alert message={error} showIcon type="error" /> : null}

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="已发布内容" loading={isLoading} suffix="条" value={feed.total} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="最新发布" loading={isLoading} value={latestPublishedAt} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="文档入口" suffix="个" value={documentEntries.length} />
            </Card>
          </Col>
        </Row>

        {isLoading ? (
          <Card>
            <Spin />
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {feed.sections.map((section) => (
              <Col key={section.key} xs={24} lg={8}>
                <AnnouncementSectionCard section={section} />
              </Col>
            ))}
          </Row>
        )}

        <Card title="文档入口">
          <Row gutter={[12, 12]}>
            {documentEntries.map((entry) => (
              <Col key={entry.href} xs={12} md={8} xl={4}>
                <Link className="home-doc-link" href={entry.href}>
                  {entry.icon}
                  <span>{entry.title}</span>
                </Link>
              </Col>
            ))}
          </Row>
        </Card>
      </Space>
    </ConsoleShell>
  );
}

function AnnouncementSectionCard({ section }: { section: AnnouncementSection }) {
  return (
    <Card title={section.title}>
      {section.items.length ? (
        <List
          dataSource={section.items}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <Typography.Text type="secondary">{formatDate(item.publishedAt ?? item.createdAt)}</Typography.Text>
                </Space>
                <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }} type="secondary">
                  {item.content}
                </Typography.Paragraph>
              </Space>
            </List.Item>
          )}
        />
      ) : (
        <Empty description={`暂无已发布${section.title}`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Card>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
