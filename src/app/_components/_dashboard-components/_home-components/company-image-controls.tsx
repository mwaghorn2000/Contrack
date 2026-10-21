"use client";

import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import ImageUploadButton, {
  uploadImage,
} from "~/app/_components/uploads/image-upload-button";

const buttonClass =
  "rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-50";

export default function CompanyImageControls({
  companyId,
  hasLogo,
  hasBanner,
}: {
  companyId: string;
  hasLogo: boolean;
  hasBanner: boolean;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const createUpload = api.company.createImageUpload.useMutation();
  const setImage = api.company.setImage.useMutation();
  const removeImage = api.company.removeImage.useMutation();

  function refresh() {
    // listCompanies includes each company logo.
    void utils.company.listCompanies.invalidate();
    router.refresh();
  }

  return (
    <div className="absolute top-3 right-3 z-20 flex flex-wrap justify-end gap-2 text-right sm:top-4 sm:right-4">
      {(["logo", "banner"] as const).map((kind) => (
        <ImageUploadButton
          key={kind}
          kind={kind}
          label={kind === "logo" ? "Change logo" : "Change banner"}
          hasImage={kind === "logo" ? hasLogo : hasBanner}
          className={buttonClass}
          onUpload={async (file) => {
            await uploadImage(file, {
              create: (file) =>
                createUpload.mutateAsync({ companyId, kind, ...file }),
              confirm: (key) => setImage.mutateAsync({ companyId, kind, key }),
            });
            refresh();
          }}
          onRemove={async () => {
            await removeImage.mutateAsync({ companyId, kind });
            refresh();
          }}
        />
      ))}
    </div>
  );
}
