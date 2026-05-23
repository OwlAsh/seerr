import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import Slider from '@app/components/Slider';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  CheckCircleIcon,
  ClockIcon,
  FilmIcon,
  PauseCircleIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.CleanupSlider', {
  mediacleanup: 'Media Cleanup',
  consentSuccess: 'Marked for deletion.',
  consentFailed: 'Failed to mark for deletion.',
  snoozeSuccess: 'Snoozed for 30 days.',
  snoozeFailed: 'Failed to snooze.',
  deleteSuccess: 'Media deleted.',
  deleteFailed: 'Failed to delete media.',
  deleteConfirm: 'Delete?',
  canWeDelete: 'Still watching?',
  yesDelete: 'Done',
  keepWatching: 'Keep',
  forceDelete: 'Force',
  readyToDelete: 'Ready',
});

interface CleanupUserStatus {
  id: number;
  plexId: number;
  displayName: string;
  avatar: string;
  status: 'finished' | 'pending' | 'active' | 'snoozed' | 'consented';
  snoozeUntil?: string;
}

interface CleanupItem {
  mediaId: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  year: string;
  seasonNumber: number | null;
  readyToDelete: boolean;
  users: CleanupUserStatus[];
}

interface CleanupResponse {
  results: CleanupItem[];
}

const statusIcon: Record<CleanupUserStatus['status'], React.ReactNode> = {
  finished: <CheckCircleIcon className="h-3.5 w-3.5 text-green-400" />,
  consented: <CheckCircleIcon className="h-3.5 w-3.5 text-green-400" />,
  pending: <QuestionMarkCircleIcon className="h-3.5 w-3.5 text-yellow-400" />,
  active: <ClockIcon className="h-3.5 w-3.5 text-blue-400" />,
  snoozed: <PauseCircleIcon className="h-3.5 w-3.5 text-gray-500" />,
};

// Card for normal users - simple "still watching?" prompt
const UserCleanupCard = ({
  item,
  onAction,
}: {
  item: CleanupItem;
  onAction: () => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const handleConsent = async () => {
    try {
      await axios.post(`/api/v1/cleanup/${item.mediaId}/consent`);
      addToast(intl.formatMessage(messages.consentSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      onAction();
    } catch {
      addToast(intl.formatMessage(messages.consentFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleSnooze = async () => {
    try {
      await axios.post(`/api/v1/cleanup/${item.mediaId}/snooze`);
      addToast(intl.formatMessage(messages.snoozeSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      onAction();
    } catch {
      addToast(intl.formatMessage(messages.snoozeFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  return (
    <div className="flex w-56 flex-col rounded-lg bg-gray-800 p-3 ring-1 ring-gray-700 sm:w-64">
      <div className="flex items-start gap-2">
        {item.mediaType === 'movie' ? (
          <FilmIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-400" />
        ) : (
          <TvIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-400" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gray-100" title={item.title}>
            {item.title}
          </h3>
          <p className="text-xs text-gray-500">{item.year}</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-yellow-400">
        {intl.formatMessage(messages.canWeDelete)}
      </p>
      <div className="mt-2 flex gap-1.5">
        <Button
          buttonType="success"
          className="flex-1 !py-1 !text-xs"
          onClick={handleConsent}
        >
          <CheckCircleIcon className="mr-1 h-3.5 w-3.5" />
          <span>{intl.formatMessage(messages.yesDelete)}</span>
        </Button>
        <Button
          buttonType="default"
          className="flex-1 !py-1 !text-xs"
          onClick={handleSnooze}
        >
          <ClockIcon className="mr-1 h-3.5 w-3.5" />
          <span>{intl.formatMessage(messages.keepWatching)}</span>
        </Button>
      </div>
    </div>
  );
};

// Card for admins - shows per-user status breakdown + own consent if pending
const AdminCleanupCard = ({
  item,
  onAction,
}: {
  item: CleanupItem;
  onAction: () => void;
}) => {
  const intl = useIntl();
  const { user } = useUser();
  const { addToast: toast } = useToasts();

  const myStatus = item.users.find((u) => u.id === user?.id);
  const iAmPending = myStatus?.status === 'pending';

  const handleConsent = async () => {
    try {
      await axios.post(`/api/v1/cleanup/${item.mediaId}/consent`);
      toast(intl.formatMessage(messages.consentSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      onAction();
    } catch {
      toast(intl.formatMessage(messages.consentFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleSnooze = async () => {
    try {
      await axios.post(`/api/v1/cleanup/${item.mediaId}/snooze`);
      toast(intl.formatMessage(messages.snoozeSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      onAction();
    } catch {
      toast(intl.formatMessage(messages.snoozeFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleDelete = async () => {
    try {
      await axios.delete(`/api/v1/cleanup/${item.mediaId}`);
      toast(intl.formatMessage(messages.deleteSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      onAction();
    } catch {
      toast(intl.formatMessage(messages.deleteFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  return (
    <div className="flex w-56 flex-col rounded-lg bg-gray-800 p-3 ring-1 ring-gray-700 sm:w-64">
      <div className="flex items-start gap-2">
        {item.mediaType === 'movie' ? (
          <FilmIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-400" />
        ) : (
          <TvIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-400" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gray-100" title={item.title}>
            {item.title}
          </h3>
          <p className="text-xs text-gray-500">{item.year}</p>
        </div>
        {item.readyToDelete && (
          <span className="flex-shrink-0 rounded-full bg-green-600/90 px-2 py-0.5 text-xs font-medium text-white">
            {intl.formatMessage(messages.readyToDelete)}
          </span>
        )}
      </div>

      {/* User status list */}
      <div className="mt-2 space-y-0.5">
        {item.users.map((u) => (
          <div key={u.id} className="flex items-center gap-1.5 text-xs text-gray-400">
            {statusIcon[u.status]}
            <span className="truncate">{u.displayName}</span>
          </div>
        ))}
      </div>

      {/* If admin is pending, show their own consent/snooze buttons */}
      {iAmPending && (
        <div className="mt-2 flex gap-1.5 border-t border-gray-700 pt-2">
          <Button
            buttonType="success"
            className="flex-1 !py-1 !text-xs"
            onClick={handleConsent}
          >
            <CheckCircleIcon className="mr-1 h-3.5 w-3.5" />
            <span>{intl.formatMessage(messages.yesDelete)}</span>
          </Button>
          <Button
            buttonType="default"
            className="flex-1 !py-1 !text-xs"
            onClick={handleSnooze}
          >
            <ClockIcon className="mr-1 h-3.5 w-3.5" />
            <span>{intl.formatMessage(messages.keepWatching)}</span>
          </Button>
        </div>
      )}

      <div className={iAmPending ? 'mt-1.5' : 'mt-2'}>
        {item.readyToDelete ? (
          <ConfirmButton
            onClick={handleDelete}
            confirmText={intl.formatMessage(messages.deleteConfirm)}
            className="w-full !py-1 !text-xs"
          >
            <TrashIcon className="mr-1 h-3.5 w-3.5" />
            <span>{intl.formatMessage(messages.yesDelete)}</span>
          </ConfirmButton>
        ) : (
          <ConfirmButton
            onClick={handleDelete}
            confirmText={intl.formatMessage(globalMessages.areyousure)}
            className="w-full !py-1 !text-xs"
          >
            <TrashIcon className="mr-1 h-3.5 w-3.5" />
            <span>{intl.formatMessage(messages.forceDelete)}</span>
          </ConfirmButton>
        )}
      </div>
    </div>
  );
};

const CleanupSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { data, mutate: mutateCleanup } = useSWR<CleanupResponse>(
    '/api/v1/cleanup'
  );

  if (data && data.results.length === 0) {
    return null;
  }

  if (!data) {
    // Show placeholder while loading to prevent layout shift
    return (
      <>
        <div className="slider-header">
          <div className="slider-title">
            <span>{intl.formatMessage(messages.mediacleanup)}</span>
          </div>
        </div>
        <div className="flex gap-4 overflow-hidden pb-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="w-56 animate-pulse rounded-lg bg-gray-800 p-3 ring-1 ring-gray-700 sm:w-64"
            >
              <div className="h-4 w-3/4 rounded bg-gray-700" />
              <div className="mt-2 h-3 w-1/2 rounded bg-gray-700" />
              <div className="mt-3 h-8 rounded bg-gray-700" />
            </div>
          ))}
        </div>
      </>
    );
  }

  const isAdmin = hasPermission(Permission.MANAGE_REQUESTS);

  return (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.mediacleanup)}</span>
        </div>
      </div>
      <Slider
        sliderKey="cleanup"
        isLoading={!data}
        items={data.results.map((item) =>
          isAdmin ? (
            <AdminCleanupCard
              key={`cleanup-${item.mediaId}-${item.seasonNumber}`}
              item={item}
              onAction={() => mutateCleanup()}
            />
          ) : (
            <UserCleanupCard
              key={`cleanup-${item.mediaId}-${item.seasonNumber}`}
              item={item}
              onAction={() => mutateCleanup()}
            />
          )
        )}
      />
    </>
  );
};

export default CleanupSlider;
