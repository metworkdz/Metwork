'use client';

/**
 * Entrepreneur profile editor. Calls PATCH /api/auth/profile.
 * Handles both basic-info updates and password changes in separate sections.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { algerianCities } from '@/config/cities';
import { AvatarUpload } from '@/components/shared/avatar-upload';
import { useAuth } from '@/components/providers/auth-provider';

interface ProfileData {
  fullName:  string;
  city:      string;
  locale:    'en' | 'fr' | 'ar';
  email:     string; // display-only, not editable
  avatarUrl?: string | null;
}

interface Props {
  initial: ProfileData;
}

export function ProfileForm({ initial }: Props) {
  const t = useTranslations('entrepreneur.profileForm');
  const { refresh } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl ?? null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [info, setInfo] = useState({
    fullName: initial.fullName,
    city:     initial.city,
    locale:   initial.locale,
  });
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoMsg,    setInfoMsg]    = useState<{ ok: boolean; text: string } | null>(null);

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg,    setPwdMsg]    = useState<{ ok: boolean; text: string } | null>(null);

  /* ── Profile info ── */
  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    setInfoSaving(true); setInfoMsg(null);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fullName: info.fullName,
          city:     info.city,
          locale:   info.locale,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Failed to save');
      }
      setInfoMsg({ ok: true, text: t('profileUpdated') });
    } catch (err) {
      setInfoMsg({ ok: false, text: err instanceof Error ? err.message : t('saveFailed') });
    } finally {
      setInfoSaving(false);
    }
  }

  /* ── Password ── */
  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.next !== pwd.confirm) {
      setPwdMsg({ ok: false, text: t('passwordMismatch') });
      return;
    }
    if (pwd.next.length < 8) {
      setPwdMsg({ ok: false, text: t('passwordTooShort') });
      return;
    }
    setPwdSaving(true); setPwdMsg(null);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: pwd.current,
          newPassword:     pwd.next,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Failed to change password');
      }
      setPwdMsg({ ok: true, text: t('passwordChanged') });
      setPwd({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwdMsg({ ok: false, text: err instanceof Error ? err.message : t('changeFailed') });
    } finally {
      setPwdSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Avatar ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('profilePictureTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-5">
          <AvatarUpload
            currentUrl={avatarUrl}
            fallbackInitials={info.fullName}
            onUpload={(url) => { setAvatarUrl(url); setAvatarError(null); void refresh(); }}
            onError={(msg) => setAvatarError(msg)}
            size="size-20"
          />
          <div>
            <p className="text-sm font-medium">{t('avatarClickHint')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('avatarFormatHint')}</p>
            {avatarError && <p className="mt-1 text-xs text-destructive">{avatarError}</p>}
          </div>
        </CardContent>
      </Card>

      {/* ── Basic info ── */}
      <form onSubmit={saveInfo}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('personalInfoTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                value={initial.email}
                disabled
                className="mt-1.5 bg-muted/50 text-muted-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('emailCannotChange')}
              </p>
            </div>

            <div>
              <Label htmlFor="fullName">{t('fullNameLabel')}</Label>
              <Input
                id="fullName"
                value={info.fullName}
                onChange={(e) => setInfo((v) => ({ ...v, fullName: e.target.value }))}
                placeholder={t('fullNamePlaceholder')}
                required
                minLength={2}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="city">{t('cityLabel')}</Label>
              <Select
                value={info.city}
                onValueChange={(v) => setInfo((prev) => ({ ...prev, city: v }))}
              >
                <SelectTrigger id="city" className="mt-1.5">
                  <SelectValue placeholder={t('cityPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {algerianCities.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="locale">{t('languageLabel')}</Label>
              <Select
                value={info.locale}
                onValueChange={(v) => setInfo((prev) => ({ ...prev, locale: v as 'en' | 'fr' | 'ar' }))}
              >
                <SelectTrigger id="locale" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {infoMsg && (
              <p className={`sm:col-span-2 text-sm ${infoMsg.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                {infoMsg.text}
              </p>
            )}

            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" loading={infoSaving}>{t('saveChanges')}</Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* ── Password ── */}
      <form onSubmit={savePassword}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('changePasswordTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="current-pwd">{t('currentPasswordLabel')}</Label>
              <Input
                id="current-pwd"
                type="password"
                value={pwd.current}
                onChange={(e) => setPwd((v) => ({ ...v, current: e.target.value }))}
                placeholder={t('currentPasswordPlaceholder')}
                autoComplete="current-password"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="new-pwd">{t('newPasswordLabel')}</Label>
              <Input
                id="new-pwd"
                type="password"
                value={pwd.next}
                onChange={(e) => setPwd((v) => ({ ...v, next: e.target.value }))}
                placeholder={t('newPasswordPlaceholder')}
                autoComplete="new-password"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="confirm-pwd">{t('confirmPasswordLabel')}</Label>
              <Input
                id="confirm-pwd"
                type="password"
                value={pwd.confirm}
                onChange={(e) => setPwd((v) => ({ ...v, confirm: e.target.value }))}
                placeholder={t('confirmPasswordPlaceholder')}
                autoComplete="new-password"
                className="mt-1.5"
              />
            </div>

            {pwdMsg && (
              <p className={`sm:col-span-2 text-sm ${pwdMsg.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                {pwdMsg.text}
              </p>
            )}

            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" loading={pwdSaving} variant="outline">
                {t('changePasswordButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Membership badge */}
      <Card>
        <CardContent className="flex items-center justify-between p-5">
          <div>
            <p className="text-sm font-medium">{t('membershipPlanTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('membershipPlanSubtitle')}
            </p>
          </div>
          <Badge variant="primary">
            {t('viewPlans')}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
