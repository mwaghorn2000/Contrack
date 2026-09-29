import Image from "next/image";

type CompanyHeaderProp = {
  name: string;
  image: string;
  bannerImage: string;
  description: string;
  website: string;
  email: string;
  phone: string;
};

export default function CompanyHeader({
  name,
  image,
  bannerImage,
  description,
  website,
  email,
  phone,
}: CompanyHeaderProp) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-sm">
      <div
        className="relative flex aspect-[4/1] items-end bg-cover bg-center p-3 sm:p-6"
        style={{ backgroundImage: `url("${bannerImage}")` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
        <div className="relative flex min-w-0 items-center gap-3 sm:gap-4">
          <Image
            src={image}
            alt={`${name} logo`}
            width={80}
            height={80}
            className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain p-1.5 shadow-sm ring-1 ring-black/5 sm:h-20 sm:w-20 sm:p-2"
          />
          <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words text-white sm:text-3xl">
            {name}
          </h1>
        </div>
      </div>
      <div className="flex w-full items-start justify-between gap-8 p-4 sm:p-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold break-words text-gray-900">
            About {name}
          </h2>
          {description && (
            <p className="mt-2 max-w-prose text-sm leading-6 break-words whitespace-pre-line text-gray-600">
              {description}
            </p>
          )}
        </div>
        {(website || email || phone) && (
          <div className="hidden w-56 min-w-0 shrink-0 flex-col gap-2 border-l border-gray-200 pl-6 text-sm leading-6 break-words text-gray-600 md:flex">
            <h2 className="font-semibold text-gray-900">Contact</h2>
            {website && <p>{website}</p>}
            {email && <p>{email}</p>}
            {phone && <p>{phone}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
