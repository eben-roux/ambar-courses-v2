<?php

declare(strict_types=1);

namespace Galeas\Api\BoundedContext\Identity\User\Projection\UserDetails;

use Doctrine\ODM\MongoDB\DocumentManager;
use Galeas\Api\BoundedContext\Identity\User\Event\PrimaryEmailChangeRequested;
use Galeas\Api\BoundedContext\Identity\User\Event\PrimaryEmailVerified;
use Galeas\Api\BoundedContext\Identity\User\Event\SignedUp;
use Galeas\Api\BoundedContext\Identity\User\Projection\UserDetails\ValueObject\UnverifiedEmail;
use Galeas\Api\BoundedContext\Identity\User\Projection\UserDetails\ValueObject\VerifiedEmail;
use Galeas\Api\BoundedContext\Identity\User\Projection\UserDetails\ValueObject\VerifiedEmailButRequestedNewEmail;
use Galeas\Api\Common\Event\Event;
use Galeas\Api\CommonException\ProjectionCannotProcess;
use Galeas\Api\Service\QueueProcessor\EventProjector;

class UserDetailsProjector implements EventProjector
{
    private DocumentManager $projectionDocumentManager;

    public function __construct(DocumentManager $projectionDocumentManager)
    {
        $this->projectionDocumentManager = $projectionDocumentManager;
    }

    public function project(Event $event): void
    {
        try {
            if (
                $event instanceof SignedUp
                || $event instanceof PrimaryEmailVerified
                || $event instanceof PrimaryEmailChangeRequested
            ) {
                $userId = $event->aggregateId()->id();
            } else {
                return;
            }

            $userDetails = $this->projectionDocumentManager
                ->createQueryBuilder(UserDetails::class)
                ->field('id')->equals($userId)
                ->getQuery()
                ->getSingleResult()
            ;

            if ($userDetails instanceof UserDetails && $event instanceof SignedUp) {
                $userDetails = UserDetails::fromProperties($userId, UnverifiedEmail::fromProperties(
                    $event->primaryEmail()
                ));
            } elseif ($userDetails instanceof UserDetails) {
                $currentStatus = $userDetails->getPrimaryEmailStatus();
                $newStatus = $this->getPrimaryEmailStatusFromEvent($event, $currentStatus);
                $userDetails->changePrimaryEmailStatus($newStatus);
            } else {
                throw new \InvalidArgumentException('Unsupported operation');
            }

            $this->projectionDocumentManager->persist($userDetails);
            $this->projectionDocumentManager->flush();
        } catch (\Throwable $throwable) {
            throw new ProjectionCannotProcess($throwable);
        }
    }

    /**
     * @throws \InvalidArgumentException
     */
    private function getPrimaryEmailStatusFromEvent(
        Event $event,
        null|UnverifiedEmail|VerifiedEmail|VerifiedEmailButRequestedNewEmail $currentStatus = null
    ): UnverifiedEmail|VerifiedEmail|VerifiedEmailButRequestedNewEmail {
        if ($event instanceof PrimaryEmailVerified && $currentStatus instanceof UnverifiedEmail) {
            return VerifiedEmail::fromProperties($currentStatus->getEmail());
        }
        if ($event instanceof PrimaryEmailVerified && $currentStatus instanceof VerifiedEmailButRequestedNewEmail) {
            return VerifiedEmail::fromProperties($currentStatus->getRequestedEmail());
        }
        if ($event instanceof PrimaryEmailChangeRequested && $currentStatus instanceof UnverifiedEmail) {
            return UnverifiedEmail::fromProperties($event->newEmailRequested());
        }
        if ($event instanceof PrimaryEmailChangeRequested && $currentStatus instanceof VerifiedEmailButRequestedNewEmail) {
            return VerifiedEmailButRequestedNewEmail::fromProperties($currentStatus->getVerifiedEmail(), $event->newEmailRequested());
        }

        throw new \InvalidArgumentException('Unsupported operation');
    }
}
