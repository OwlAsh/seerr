import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import Slider from '@app/components/Slider';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  CheckCircleIcon,
  ClockIcon,
  PauseCircleIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
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
    <div className="relative flex w-36 flex-col overflow-hidden rounded-xl bg-gray-800 shadow-md ring-1 ring-gray-700 sm:w-44">
      <div className="relative aspect-[2/3] w-full">
        <CachedImage
          type="tmdb"
          className="absolute inset-0 h-full w-full"
          alt={item.title}
          src={
            item.posterPath
              ? `https://image.tmdb.org/t/p/w300_and_h450_face${item.posterPath}`
              : `/images/seerr_poster_not_found_logo_top.png`
          }
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          fill
        />
      </div>
      <div className="flex flex-1 flex-col p-2">
        <h3 className="truncate text-sm font-bold text-gray-100" title={item.title}>
          {item.title}
        </h3>
        <p className="text-xs text-gray-400">{item.year}</p>
        <p className="mt-1 text-xs text-yellow-400">
          {intl.formatMessage(messages.canWeDelete)}
        </p>
        <div className="mt-2 flex gap-1">
          <Button
            buttonType="success"
            className="flex-1 !px-1 !py-1 !text-xs"
            onClick={handleConsent}
          >
            <CheckCircleIcon className="mr-0.5 h-3 w-3" />
            <span>{intl.formatMessage(messages.yesDelete)}</span>
          </Button>
          <Button
            buttonType="default"
            className="flex-1 !px-1 !py-1 !text-xs"
            onClick={handleSnooze}
          >
            <ClockIcon className="mr-0.5 h-3 w-3" />
            <span>{intl.formatMessage(messages.keepWatching)}</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

// Card for admins - shows per-user status breakdown
const AdminCleanupCard = ({
  item,
  onAction,
}: {
  item: CleanupItem;
  onAction: () => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const handleDelete = async () => {
    try {
      await axios.delete(`/api/v1/cleanup/${item.mediaId}`);
      addToast(intl.formatMessage(messages.deleteSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      onAction();
    } catch {
      addToast(intl.formatMessage(messages.deleteFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  return (
    <div className="relative flex w-44 flex-col overflow-hidden rounded-xl bg-gray-800 shadow-md ring-1 ring-gray-700 sm:w-52">
      <div className="relative aspect-[2/3] w-full">
        <CachedImage
          type="tmdb"
          className="absolute inset-0 h-full w-full"
          alt={item.title}
          src={
            item.posterPath
              ? `https://image.tmdb.org/t/p/w300_and_h450_face${item.posterPath}`
              : `/images/seerr_poster_not_found_logo_top.png`
          }
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          fill
        />
        {item.readyToDelete && (
          <div className="absolute right-2 top-2 rounded-full bg-green-600/90 px-2 py-0.5 text-xs font-medium text-white">
            {intl.formatMessage(messages.readyToDelete)}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-2">
        <h3 className="truncate text-sm font-bold text-gray-100" title={item.title}>
          {item.title}
        </h3>
        <p className="text-xs text-gray-400">{item.year}</p>

        {/* User status list */}
        <div className="mt-1.5 space-y-0.5">
          {item.users.map((u) => (
            <div key={u.id} className="flex items-center gap-1 text-xs text-gray-400">
              {statusIcon[u.status]}
              <span className="truncate">{u.displayName}</span>
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-1">
          {item.readyToDelete ? (
            <ConfirmButton
              onClick={handleDelete}
              confirmText={intl.formatMessage(messages.deleteConfirm)}
              className="flex-1 !px-1 !py-1 !text-xs"
            >
              <TrashIcon className="mr-0.5 h-3 w-3" />
              <span>{intl.formatMessage(messages.yesDelete)}</span>
            </ConfirmButton>
          ) : (
            <ConfirmButton
              onClick={handleDelete}
              confirmText={intl.formatMessage(globalMessages.areyousure)}
              className="flex-1 !px-1 !py-1 !text-xs"
            >
              <TrashIcon className="mr-0.5 h-3 w-3" />
              <span>{intl.formatMessage(messages.forceDelete)}</span>
            </ConfirmButton>
          )}
        </div>
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

  if (!data || data.results.length === 0) {
    return null;
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
