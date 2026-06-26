import { Inject, Injectable } from '@nestjs/common';
import { Announcement, AnnouncementCategory, AnnouncementStatus } from '../generated/prisma/client';
import { resolveLocalizedText } from '../i18n/localized-content';
import { PrismaService } from '../prisma.service';

const SECTION_DEFINITIONS = [
  {
    category: AnnouncementCategory.ANNOUNCEMENT,
    key: 'announcement',
    title: '平台公告',
    translations: {
      'zh-CN': { title: '平台公告' },
      'zh-TW': { title: '平台公告' },
      'en-US': { title: 'Platform announcements' },
      es: { title: 'Anuncios de la plataforma' },
      fr: { title: 'Annonces de la plateforme' },
      de: { title: 'Plattformankundigungen' },
      pt: { title: 'Avisos da plataforma' },
      ja: { title: 'プラットフォームのお知らせ' },
      ko: { title: '플랫폼 공지' },
      ru: { title: 'Объявления платформы' },
      ar: { title: 'إعلانات المنصة' },
      sw: { title: 'Matangazo ya jukwaa' },
      am: { title: 'የመድረክ ማስታወቂያዎች' },
      ha: { title: 'Sanarwar dandali' },
      yo: { title: 'Awọn ikede pẹpẹ' },
      ig: { title: 'Ọkwa ikpo okwu' },
      zu: { title: 'Izaziso zeplathifomu' },
      af: { title: 'Platformaankondigings' },
      so: { title: 'Ogeysiisyada madasha' },
      rw: { title: 'Amatangazo ya platform' },
      om: { title: 'Beeksisoota waltajjii' },
      hi: { title: 'प्लेटफॉर्म घोषणाएं' },
      id: { title: 'Pengumuman platform' },
      tr: { title: 'Platform duyuruları' },
      vi: { title: 'Thông báo nền tảng' },
      th: { title: 'ประกาศแพลตฟอร์ม' },
      it: { title: 'Annunci della piattaforma' },
      nl: { title: 'Platformaankondigingen' },
      pl: { title: 'Ogłoszenia platformy' },
      uk: { title: 'Оголошення платформи' },
      ms: { title: 'Pengumuman platform' },
      fa: { title: 'اعلان های پلتفرم' }
    }
  },
  {
    category: AnnouncementCategory.UPDATE_LOG,
    key: 'update_log',
    title: '更新日志',
    translations: {
      'zh-CN': { title: '更新日志' },
      'zh-TW': { title: '更新日誌' },
      'en-US': { title: 'Update log' },
      es: { title: 'Registro de actualizaciones' },
      fr: { title: 'Journal des mises a jour' },
      de: { title: 'Aktualisierungsprotokoll' },
      pt: { title: 'Registro de atualizacoes' },
      ja: { title: '更新履歴' },
      ko: { title: '업데이트 로그' },
      ru: { title: 'Журнал обновлений' },
      ar: { title: 'سجل التحديثات' },
      sw: { title: 'Kumbukumbu ya masasisho' },
      am: { title: 'የዝመና መዝገብ' },
      ha: { title: 'Tarihin sabuntawa' },
      yo: { title: 'Akosile imudojuiwon' },
      ig: { title: 'Ndekọ mmelite' },
      zu: { title: 'Umlando wezibuyekezo' },
      af: { title: 'Opdateringslogboek' },
      so: { title: 'Diiwaanka cusboonaysiinta' },
      rw: { title: "Inyandiko z'impinduka" },
      om: { title: 'Galmee haaromsa' },
      hi: { title: 'अपडेट लॉग' },
      id: { title: 'Log pembaruan' },
      tr: { title: 'Guncelleme gunlugu' },
      vi: { title: 'Nhat ky cap nhat' },
      th: { title: 'บันทึกการอัปเดต' },
      it: { title: 'Registro aggiornamenti' },
      nl: { title: 'Updategeschiedenis' },
      pl: { title: 'Dziennik aktualizacji' },
      uk: { title: 'Журнал оновлень' },
      ms: { title: 'Log kemas kini' },
      fa: { title: 'گزارش به روزرسانی' }
    }
  },
  {
    category: AnnouncementCategory.USAGE_GUIDE,
    key: 'usage_guide',
    title: '使用建议',
    translations: {
      'zh-CN': { title: '使用建议' },
      'zh-TW': { title: '使用建議' },
      'en-US': { title: 'Usage tips' },
      es: { title: 'Consejos de uso' },
      fr: { title: 'Conseils d utilisation' },
      de: { title: 'Nutzungstipps' },
      pt: { title: 'Dicas de uso' },
      ja: { title: '使い方のヒント' },
      ko: { title: '사용 팁' },
      ru: { title: 'Советы по использованию' },
      ar: { title: 'نصائح الاستخدام' },
      sw: { title: 'Vidokezo vya matumizi' },
      am: { title: 'የአጠቃቀም ምክሮች' },
      ha: { title: 'Shawarwar amfani' },
      yo: { title: 'Awon imoran lilo' },
      ig: { title: 'Ndụmọdụ iji' },
      zu: { title: 'Amathiphu okusebenzisa' },
      af: { title: 'Gebruikwenke' },
      so: { title: 'Talooyinka isticmaalka' },
      rw: { title: 'Inama zo gukoresha' },
      om: { title: 'Gorsa itti fayyadamaa' },
      hi: { title: 'उपयोग सुझाव' },
      id: { title: 'Tips penggunaan' },
      tr: { title: 'Kullanim ipuclari' },
      vi: { title: 'Meo su dung' },
      th: { title: 'เคล็ดลับการใช้งาน' },
      it: { title: 'Suggerimenti d uso' },
      nl: { title: 'Gebruikwenke' },
      pl: { title: 'Wskazowki uzycia' },
      uk: { title: 'Поради з використання' },
      ms: { title: 'Petua penggunaan' },
      fa: { title: 'نکات استفاده' }
    }
  }
] as const;

@Injectable()
export class AnnouncementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPublished(language?: string | null) {
    const now = new Date();
    const announcements = await this.prisma.announcement.findMany({
      where: {
        status: AnnouncementStatus.PUBLISHED,
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }]
      },
      orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 60
    });

    const publicItems = await Promise.all(
      announcements.map((announcement) => this.toPublicAnnouncement(announcement, language))
    );

    return {
      generatedAt: new Date().toISOString(),
      total: publicItems.length,
      sections: SECTION_DEFINITIONS.map((section) => ({
        key: section.key,
        title: resolveSectionTitle(section, language),
        items: publicItems.filter((item) => item.category === section.key)
      }))
    };
  }

  private async toPublicAnnouncement(announcement: Announcement, language?: string | null) {
    return {
      id: announcement.id,
      title: resolveLocalizedText(announcement.translations, language, 'title', announcement.title) ?? announcement.title,
      content: resolveLocalizedText(announcement.translations, language, 'content', announcement.content) ?? announcement.content,
      category: announcement.category.toLowerCase(),
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString()
    };
  }
}

function resolveSectionTitle(section: (typeof SECTION_DEFINITIONS)[number], language?: string | null) {
  return resolveLocalizedText(section.translations, language, 'title', section.title);
}
