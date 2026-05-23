import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import Slider from '@app/components/Slider';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  ClockIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { MediaType } from '@server/constants/media';
import axios from 'axios';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.CleanupSlider', {
  mediacleanup: 'Media Cleanup',
  deletemedia: 'Delete',
  snooze: 'Snooze 30d',
  deleteSuccess: 'Media successfully deleted.',
  deleteFailed: 'Failed to delete media.',
  snoozeSuccess: 'Media snoozed for 30 days.',
  snoozeFailed: 'Failed to snooze media.',
  requestedby: 'Requested by {user}',
  plays: '{count, plural, one {# play} other {# plays}}',
});

interface CleanupItem {
  mediaId: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  year: string;
  requestedBy: {
    id: number;
    displayName: string;
    avatar: string;
  };
  requestedAt: string;
  watchStats: {
    totalPlays: number;
    totalTime: number;
  };
}

interface CleanupResponse {
  results: CleanupItem[];
}

const CleanupCard = ({
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

  const requestDate = new Date(item.requestedAt).toLocaleDateString();

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
        <div className="absolute left-0 right-0 flex items-center justify-between p-2">
          <div
            className={`pointer-events-none z-40 self-start rounded-full border shadow-md ${
              item.mediaType === 'movie'
                ? 'border-blue-500 bg-blue-600/80'
                : 'border-purple-600 bg-purple-600/80'
            }`}
          >
            <div className="flex items-center px-2 py-0.5 text-xs font-medium text-gray-100">
              {item.mediaType === 'movie' ? 'Movie' : 'Series'}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-2">
        <h3
          className="truncate text-sm font-bold text-gray-100"
          title={item.title}
        >
          {item.title}
        </h3>
        <p className="text-xs text-gray-400">
          {item.year} &middot;{' '}
          {intl.formatMessage(messages.plays, {
            count: item.watchStats.totalPlays,
          })}
        </p>
        <p className="mt-0.5 truncate text-xs text-gray-500" title={item.requestedBy.displayName}>
          {intl.formatMessage(messages.requestedby, {
            user: item.requestedBy.displayName,
          })}
        </p>
        <p className="text-xs text-gray-500">{requestDate}</p>
        <div className="mt-2 flex gap-1">
          <ConfirmButton
            onClick={handleDelete}
            confirmText={intl.formatMessage(globalMessages.areyousure)}
            className="flex-1 !px-1 !py-1 !text-xs"
          >
            <TrashIcon className="mr-0.5 h-3 w-3" />
            <span>{intl.formatMessage(messages.deletemedia)}</span>
          </ConfirmButton>
          <Button
            buttonType="default"
            className="flex-1 !px-1 !py-1 !text-xs"
            onClick={handleSnooze}
          >
            <ClockIcon className="mr-0.5 h-3 w-3" />
            <span>{intl.formatMessage(messages.snooze)}</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

const CleanupSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { data, mutate: mutateCleanup } = useSWR<CleanupResponse>(
    hasPermission(Permission.MANAGE_REQUESTS) ? '/api/v1/cleanup' : null
  );

  if (!hasPermission(Permission.MANAGE_REQUESTS)) {
    return null;
  }

  if (!data || data.results.length === 0) {
    return null;
  }

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
        items={data.results.map((item) => (
          <CleanupCard
            key={`cleanup-${item.mediaId}`}
            item={item}
            onAction={() => mutateCleanup()}
          />
        ))}
      />
    </>
  );
};

export default CleanupSlider;
