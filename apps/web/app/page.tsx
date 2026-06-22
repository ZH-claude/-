'use client';

import {
  ApiOutlined,
  AppstoreOutlined,
  BellOutlined,
  CloseOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  KeyOutlined,
  MessageOutlined
} from '@ant-design/icons';
import { Alert, Card, Col, Empty, List, Row, Space, Spin, Statistic, Typography } from 'antd';
import Link from 'next/link';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { ConsoleShell } from './components/console-shell';
import { listPublishedAnnouncements } from './lib/announcements-api';
import type { AnnouncementFeedResponse, AnnouncementSection } from './lib/announcements-api';
import { getSiteContentConfig, type SiteContentConfig } from './lib/site-content-api';

const documentEntries = [
  { title: '模型广场', href: '/pricing', icon: <AppstoreOutlined /> },
  { title: '模型体验', href: '/experience', icon: <MessageOutlined /> },
  { title: '令牌管理', href: '/token', icon: <KeyOutlined /> },
  { title: '调用日志', href: '/log', icon: <FileTextOutlined /> },
  { title: '余额充值', href: '/account/topup/recharge', icon: <CreditCardOutlined /> },
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

const defaultSiteContent: SiteContentConfig = {
  id: 'default',
  home: {
    title: '蔚蓝星球中转站',
    subtitle: '智能服务中转后台',
    content: null,
    fontFamily: 'system',
    textColor: '#111827',
    accentColor: '#2563eb'
  },
  popup: {
    enabled: false,
    title: null,
    content: null,
    fontFamily: 'system',
    textColor: '#111827',
    accentColor: '#2563eb'
  },
  updatedAt: null
};

export default function HomePage() {
  const [feed, setFeed] = useState<AnnouncementFeedResponse>(emptyFeed);
  const [siteContent, setSiteContent] = useState<SiteContentConfig>(defaultSiteContent);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadHomeData() {
      setIsLoading(true);
      setError('');

      try {
        const [nextFeed, nextSiteContent] = await Promise.all([
          listPublishedAnnouncements(),
          getSiteContentConfig()
        ]);
        if (!cancelled) {
          setFeed(nextFeed);
          setSiteContent(nextSiteContent);
          setIsPopupOpen(nextSiteContent.popup.enabled);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '首页内容加载失败');
          setFeed(emptyFeed);
          setSiteContent(defaultSiteContent);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadHomeData();

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

  const homeStyle = {
    color: siteContent.home.textColor,
    fontFamily: resolveFontFamily(siteContent.home.fontFamily)
  } satisfies CSSProperties;

  return (
    <ConsoleShell activePath="/">
      <section className="profile-card account-summary site-home-hero" style={homeStyle}>
        <div>
          <p className="eyebrow" style={{ color: siteContent.home.accentColor }}>首页</p>
          <h1 style={{ color: siteContent.home.accentColor }}>{siteContent.home.title}</h1>
          <p className="page-subtitle" style={{ color: siteContent.home.textColor }}>
            <ApiOutlined /> {siteContent.home.subtitle}
          </p>
          {siteContent.home.content ? <p className="site-home-content">{siteContent.home.content}</p> : null}
        </div>
      </section>

      {isPopupOpen && siteContent.popup.enabled ? (
        <SiteAnnouncementPopup config={siteContent} onClose={() => setIsPopupOpen(false)} />
      ) : null}

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

function SiteAnnouncementPopup({ config, onClose }: { config: SiteContentConfig; onClose: () => void }) {
  const popupStyle = {
    color: config.popup.textColor,
    fontFamily: resolveFontFamily(config.popup.fontFamily)
  } satisfies CSSProperties;

  return (
    <div className="site-announcement-backdrop" role="presentation">
      <section
        aria-labelledby="site-announcement-title"
        aria-modal="true"
        className="site-announcement-modal"
        role="dialog"
        style={popupStyle}
      >
        <button className="site-announcement-close" onClick={onClose} title="关闭公告" type="button">
          <CloseOutlined />
        </button>
        <p className="eyebrow" style={{ color: config.popup.accentColor }}>公告</p>
        <h2 id="site-announcement-title" style={{ color: config.popup.accentColor }}>{config.popup.title}</h2>
        <p>{config.popup.content}</p>
        <button className="primary-button" onClick={onClose} style={{ background: config.popup.accentColor }} type="button">
          我知道了
        </button>
      </section>
    </div>
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

function resolveFontFamily(fontFamily: SiteContentConfig['home']['fontFamily']) {
  const families: Record<SiteContentConfig['home']['fontFamily'], string> = {
    system: 'Arial, Helvetica, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    rounded: '"Trebuchet MS", "Microsoft YaHei", sans-serif',
    mono: 'Consolas, "Liberation Mono", monospace'
  };

  return families[fontFamily] ?? families.system;
}
