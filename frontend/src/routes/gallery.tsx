import { createFileRoute } from '@tanstack/react-router';
import { Images } from 'lucide-react';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { ImageGallery } from '../components/gallery/ImageGallery';

export const Route = createFileRoute('/gallery')({
  component: GalleryPage,
} as any);

function GalleryPage() {
  return (
    <PageContainer>
      <PageHeader
        subtext="Storage"
        title="Image gallery"
        description="Keep track of the images Fainens stores for receipts, agent conversations, and wishlist items."
      />
      <Card title={<div className="flex items-center gap-2"><Images className="h-5 w-5" /> Managed images</div>}>
        <ImageGallery />
      </Card>
    </PageContainer>
  );
}
