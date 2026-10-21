"use client";

import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import ImageUploadButton, {
  uploadImage,
} from "~/app/_components/uploads/image-upload-button";

export default function CompanyImageEditButton({
  companyId,
  kind,
  className,
}: {
  companyId: string;
  kind: "logo" | "banner";
  className?: string;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const createUpload = api.company.createImageUpload.useMutation();
  const setImage = api.company.setImage.useMutation();

  return (
    <ImageUploadButton
      kind={kind}
      variant="icon"
      iconSize={kind === "logo" ? "sm" : "md"}
      label={kind === "logo" ? "Change logo" : "Change banner"}
      className={className}
      onUpload={async (file) => {
        await uploadImage(file, kind, {
          create: (file) =>
            createUpload.mutateAsync({ companyId, kind, ...file }),
          confirm: (key) => setImage.mutateAsync({ companyId, kind, key }),
        });
        // listCompanies includes each company logo.
        void utils.company.listCompanies.invalidate();
        router.refresh();
      }}
    />
  );
}
