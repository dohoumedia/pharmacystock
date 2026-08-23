import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import {
  loadAssignableRoles,
  loadStaff,
  replaceStaffBranches,
  updateStaffMembership,
  type Role,
  type StaffMember,
} from '@/services/organization';

export default function StaffScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { organization, branches, role: currentRole, can } = useOrganization();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const canManage = can('staff.manage');
  const visibleRoles = useMemo(
    () => roles.filter((role) => role.code !== 'OWNER' || currentRole?.code === 'OWNER'),
    [roles, currentRole?.code],
  );

  const refresh = useCallback(async () => {
    if (!organization || !canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [nextStaff, nextRoles] = await Promise.all([
        loadStaff(organization.id),
        loadAssignableRoles(organization.id),
      ]);
      setStaff(nextStaff);
      setRoles(nextRoles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, [organization, canManage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeRole = async (member: StaffMember, roleId: string) => {
    if (member.membership.user_id === user?.id || member.membership.role_id === roleId) return;
    setSavingId(member.membership.id);
    setError(null);
    try {
      await updateStaffMembership(member.membership.id, {
        role_id: roleId,
        status: member.membership.status,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSavingId(null);
    }
  };

  const toggleStatus = async (member: StaffMember) => {
    if (member.membership.user_id === user?.id) return;
    setSavingId(member.membership.id);
    setError(null);
    try {
      await updateStaffMembership(member.membership.id, {
        role_id: member.membership.role_id,
        status: member.membership.status === 'active' ? 'suspended' : 'active',
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSavingId(null);
    }
  };

  const toggleBranch = async (member: StaffMember, branchId: string) => {
    if (member.membership.user_id === user?.id) return;
    const next = member.branchIds.includes(branchId)
      ? member.branchIds.filter((id) => id !== branchId)
      : [...member.branchIds, branchId];
    setSavingId(member.membership.id);
    setError(null);
    try {
      await replaceStaffBranches(member.membership.id, member.branchIds, next);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{t('organization.staffTitle')}</Text>
            <Text style={styles.subtitle}>{t('organization.staffSubtitle')}</Text>
          </View>
          <Link href="/" asChild>
            <Pressable style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>{t('organization.back')}</Text>
            </Pressable>
          </Link>
        </View>

        <Text style={styles.securityNote}>{t('organization.securityNote')}</Text>

        {!canManage ? (
          <View style={styles.card}><Text style={styles.body}>{t('organization.cannotManage')}</Text></View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void refresh()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? <Text style={styles.body}>{t('common.loading')}</Text> : null}

        {canManage && !loading && staff.length === 0 ? (
          <View style={styles.card}><Text style={styles.body}>{t('common.noData')}</Text></View>
        ) : null}

        {canManage ? staff.map((member) => {
          const isSelf = member.membership.user_id === user?.id;
          const isSaving = savingId === member.membership.id;
          const displayName = member.profile?.display_name || member.membership.user_id.slice(0, 8);
          const roleName = member.role
            ? (i18n.language === 'fr' ? member.role.name_fr : member.role.name_en)
            : t('organization.noRole');

          return (
            <View style={styles.card} key={member.membership.id}>
              <View style={styles.memberHeader}>
                <View style={styles.memberIdentity}>
                  <Text style={styles.memberName}>{displayName}</Text>
                  <Text style={styles.meta}>{roleName}</Text>
                </View>
                <Pressable
                  disabled={isSelf || isSaving}
                  onPress={() => void toggleStatus(member)}
                  style={[styles.statusChip, member.membership.status !== 'active' && styles.statusChipSuspended, isSelf && styles.disabled]}
                >
                  <Text style={styles.statusText}>
                    {member.membership.status === 'active' ? t('common.active') : t('common.suspended')}
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.sectionLabel}>{t('organization.role')}</Text>
              <View style={styles.chips}>
                {visibleRoles.map((role) => (
                  <Pressable
                    key={role.id}
                    disabled={isSelf || isSaving}
                    onPress={() => void changeRole(member, role.id)}
                    style={[styles.chip, member.membership.role_id === role.id && styles.chipSelected, isSelf && styles.disabled]}
                  >
                    <Text style={[styles.chipText, member.membership.role_id === role.id && styles.chipTextSelected]}>
                      {i18n.language === 'fr' ? role.name_fr : role.name_en}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.sectionLabel}>{t('organization.branchAccess')}</Text>
              <View style={styles.chips}>
                {branches.map((branch) => {
                  const selected = member.branchIds.includes(branch.id);
                  return (
                    <Pressable
                      key={branch.id}
                      disabled={isSelf || isSaving}
                      onPress={() => void toggleBranch(member, branch.id)}
                      style={[styles.chip, selected && styles.chipSelected, isSelf && styles.disabled]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{branch.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {isSaving ? <Text style={styles.meta}>{t('common.loading')}</Text> : null}
            </View>
          );
        }) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8FC' },
  container: { padding: 24, gap: 16, width: '100%', maxWidth: 980, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  headerText: { flex: 1, minWidth: 260, gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  subtitle: { fontSize: 15, color: '#667085' },
  body: { color: '#344159', fontSize: 15 },
  meta: { color: '#667085', fontSize: 13 },
  securityNote: { color: '#46536A', fontSize: 13 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, gap: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 },
  errorCard: { backgroundColor: '#FFF5F5', borderRadius: 14, padding: 16, gap: 10 },
  errorText: { color: '#9F1239' },
  memberHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  memberIdentity: { flex: 1, gap: 2 },
  memberName: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#46536A' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#102A5C', borderColor: '#102A5C' },
  chipText: { color: '#344159', fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#FFFFFF' },
  statusChip: { backgroundColor: '#E7F8EF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  statusChipSuspended: { backgroundColor: '#FFF0F0' },
  statusText: { color: '#344159', fontSize: 13, fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#98A2B3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344159', fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
